import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.106.0";
import * as pdfjsLib from "npm:pdfjs-dist@5.7.284/build/pdf.mjs";

declare const EdgeRuntime: {
  waitUntil: (promise: Promise<unknown>) => void;
};

const EPUB_BUCKET = "epubs";

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

type BookRow = {
  document_type: string | null;
  file_name: string;
  id: string;
  storage_path: string;
  user_id: string;
};

type PdfTocEntry = {
  pageNumber: number;
  pageOffsetRatio: number;
  title: string;
};

const requiredEnv = (name: string) => {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });

const cleanId = (value: unknown, maxLength = 80) =>
  String(value ?? "")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, maxLength);

const normaliseSpace = (text: string) => text.replace(/\s+/g, " ").trim();

const wordCount = (text: string) => Array.from(text.matchAll(/\S+/g)).length;

const textFromPage = async (page: Awaited<ReturnType<pdfjsLib.PDFDocumentProxy["getPage"]>>) => {
  const content = await page.getTextContent();
  const lines: string[] = [];
  let currentLine = "";

  for (const item of content.items) {
    if (!("str" in item)) continue;
    const text = item.str.trim();
    if (text) currentLine = currentLine ? `${currentLine} ${text}` : text;
    if (item.hasEOL) {
      if (currentLine) lines.push(currentLine);
      currentLine = "";
    }
  }

  if (currentLine) lines.push(currentLine);
  return lines.join("\n");
};

const destName = (dest: unknown) => {
  if (dest && typeof dest === "object" && "name" in dest && typeof dest.name === "string") return dest.name;
  return typeof dest === "string" ? dest : "";
};

const topValueFromDest = (dest: unknown[]) => {
  const name = destName(dest[1]);

  switch (name) {
    case "XYZ":
      return typeof dest[3] === "number" ? dest[3] : null;
    case "FitH":
    case "FitBH":
      return typeof dest[2] === "number" ? dest[2] : null;
    case "FitR":
      return typeof dest[5] === "number" ? dest[5] : null;
    default:
      return null;
  }
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const resolveDestTarget = async (
  pdf: pdfjsLib.PDFDocumentProxy,
  dest: Awaited<ReturnType<pdfjsLib.PDFDocumentProxy["getOutline"]>>[number]["dest"]
) => {
  const resolvedDest = typeof dest === "string" ? await pdf.getDestination(dest).catch(() => null) : dest;
  const ref = resolvedDest?.[0];
  if (!ref) return null;

  let pageNumber: number | null = null;
  if (typeof ref === "object") {
    const index = await pdf.getPageIndex(ref).catch(() => null);
    pageNumber = typeof index === "number" ? index + 1 : null;
  } else if (typeof ref === "number") {
    pageNumber = ref + 1;
  }

  if (!pageNumber) return null;

  const top = Array.isArray(resolvedDest) ? topValueFromDest(resolvedDest) : null;
  if (typeof top !== "number") return { pageNumber, pageOffsetRatio: 0 };

  const page = await pdf.getPage(pageNumber).catch(() => null);
  if (!page) return { pageNumber, pageOffsetRatio: 0 };

  const viewport = page.getViewport({ scale: 1 });
  const [, viewportY] = viewport.convertToViewportPoint(0, top);
  return {
    pageNumber,
    pageOffsetRatio: clamp(viewportY / viewport.height, 0, 1)
  };
};

const collectTocEntries = async (pdf: pdfjsLib.PDFDocumentProxy) => {
  const outline = await pdf.getOutline().catch(() => null);
  if (!outline?.length) return [];

  const entries: PdfTocEntry[] = [];

  const visit = async (nodes: NonNullable<typeof outline>, level: number) => {
    for (const node of nodes) {
      const title = normaliseSpace(`${level > 0 ? "  ".repeat(Math.min(level, 3)) : ""}${node.title ?? ""}`);
      const target = await resolveDestTarget(pdf, node.dest);

      if (title && target && target.pageNumber >= 1 && target.pageNumber <= pdf.numPages) {
        const previous = entries.at(-1);
        if (!(previous?.title === title && previous.pageNumber === target.pageNumber)) {
          entries.push({ ...target, title });
        }
      }

      if (node.items?.length) await visit(node.items as NonNullable<typeof outline>, level + 1);
    }
  };

  await visit(outline, 0);
  return entries;
};

const updateBookStatus = async (adminClient: any, bookId: string, fields: Record<string, unknown>) => {
  const { error } = await adminClient.from("books").update(fields).eq("id", bookId);
  if (error) throw error;
};

const upsertPages = async (adminClient: any, pages: Array<Record<string, unknown>>) => {
  for (let index = 0; index < pages.length; index += 100) {
    const batch = pages.slice(index, index + 100);
    const { error } = await adminClient
      .from("book_pages")
      .upsert(batch, { onConflict: "book_id,page_number" });
    if (error) throw error;
  }
};

const processPdf = async (adminClient: any, book: BookRow) => {
  await updateBookStatus(adminClient, book.id, {
    processing_error: null,
    processing_started_at: new Date().toISOString(),
    processing_status: "processing"
  });

  try {
    const { data, error } = await adminClient.storage.from(EPUB_BUCKET).download(book.storage_path);
    if (error) throw error;
    if (!data) throw new Error("PDF file could not be downloaded.");

    const bytes = new Uint8Array(await data.arrayBuffer());
    const pdf = await pdfjsLib.getDocument({ data: bytes.slice(0), disableWorker: true } as any).promise;

    try {
      const tocEntries = await collectTocEntries(pdf);
      const pageRows: Array<Record<string, unknown>> = [];
      const pageMetrics: Array<{ height: number; width: number }> = [];
      let extractedPageCount = 0;
      let extractedWordCount = 0;

      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 1 });
        const text = normaliseSpace(await textFromPage(page));
        const pageWordCount = wordCount(text);

        pageMetrics.push({ height: viewport.height, width: viewport.width });
        if (text) extractedPageCount += 1;
        extractedWordCount += pageWordCount;

        pageRows.push({
          book_id: book.id,
          page_number: pageNumber,
          text,
          user_id: book.user_id,
          word_count: pageWordCount
        });
      }

      await upsertPages(adminClient, pageRows);
      await updateBookStatus(adminClient, book.id, {
        chapter_count: tocEntries.length,
        page_count: pdf.numPages,
        paragraph_count: extractedPageCount,
        pdf_page_metrics: pageMetrics,
        pdf_toc: tocEntries,
        processed_at: new Date().toISOString(),
        processing_error: null,
        processing_status: "processed"
      });
    } finally {
      await pdf.destroy();
    }
  } catch (error) {
    await updateBookStatus(adminClient, book.id, {
      processing_error: error instanceof Error ? error.message : "PDF processing failed.",
      processing_status: "failed"
    });
    throw error;
  }
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const anonKey = requiredEnv("SUPABASE_ANON_KEY");
    const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const authorization = req.headers.get("Authorization");

    if (!authorization) throw new Error("Missing Authorization header");

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } }
    });
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: userData, error: userError } = await userClient.auth.getUser();

    if (userError || !userData.user) throw new Error("You must be signed in to process documents.");

    const payload = await req.json();
    const bookId = cleanId(payload.bookId);
    const waitForCompletion = payload.waitForCompletion === true;
    if (!bookId) throw new Error("No book was provided for processing.");

    const { data: book, error: bookError } = await userClient
      .from("books")
      .select("document_type, file_name, id, storage_path, user_id")
      .eq("id", bookId)
      .eq("user_id", userData.user.id)
      .maybeSingle();

    if (bookError) throw bookError;
    if (!book) throw new Error("You can only process your own books.");
    if (book.document_type !== "pdf") throw new Error("Only PDFs need background processing.");

    const task = processPdf(adminClient, book as BookRow);
    if (waitForCompletion) {
      await task;
      return jsonResponse({ processed: true });
    }

    EdgeRuntime.waitUntil(task);
    return jsonResponse({ queued: true });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Could not process this document." },
      400
    );
  }
});
