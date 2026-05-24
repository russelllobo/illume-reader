import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import type { ReaderBook, ReaderParagraph } from "./epub";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type PdfInfo = {
  Author?: string;
  Title?: string;
};

type PdfOutlineNode = Awaited<ReturnType<pdfjsLib.PDFDocumentProxy["getOutline"]>>[number];

type PdfTocEntry = {
  level: number;
  pageNumber: number;
  pageOffsetRatio: number;
  title: string;
};

export type PdfPreview = {
  author: string;
  chapterPageNumbers: number[];
  chapterPageOffsets: number[];
  chapters: string[];
  pageCount: number;
  pageMetrics: Array<{ height: number; width: number }>;
  title: string;
};

const normaliseSpace = (text: string) => text.replace(/\s+/g, " ").trim();

const fileTitle = (file: File) => file.name.replace(/\.pdf$/i, "").replace(/[-_]+/g, " ").trim() || file.name;

const splitPageText = (text: string) =>
  text
    .split(/\n{2,}/)
    .map(normaliseSpace)
    .filter((paragraph) => paragraph.length > 35);

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

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

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

const resolveDestTarget = async (
  pdf: pdfjsLib.PDFDocumentProxy,
  dest: PdfOutlineNode["dest"]
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

  const visit = async (nodes: PdfOutlineNode[], level: number) => {
    for (const node of nodes) {
      const title = normaliseSpace(node.title ?? "");
      const target = await resolveDestTarget(pdf, node.dest);

      if (title && target && target.pageNumber >= 1 && target.pageNumber <= pdf.numPages) {
        const previous = entries.at(-1);
        if (!(previous?.title === title && previous.pageNumber === target.pageNumber)) {
          entries.push({ level, ...target, title });
        }
      }

      if (node.items?.length) await visit(node.items as PdfOutlineNode[], level + 1);
    }
  };

  await visit(outline, 0);

  return entries
    .filter((entry, index, items) => {
      const previous = items[index - 1];
      return !(previous?.title === entry.title && previous.pageNumber === entry.pageNumber);
    });
};

const chapterIndexForPage = (toc: PdfTocEntry[], pageNumber: number) => {
  if (!toc.length) return 0;

  let index = 0;
  for (let entryIndex = 0; entryIndex < toc.length; entryIndex += 1) {
    if (toc[entryIndex].pageNumber <= pageNumber) index = entryIndex;
    else break;
  }

  return index;
};

export const parsePdf = async (file: File): Promise<ReaderBook> => {
  const bytes = await file.arrayBuffer();
  let pdf: pdfjsLib.PDFDocumentProxy;

  try {
    pdf = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  } catch {
    throw new Error("This file could not be read as a PDF. It may be encrypted, incomplete, or damaged.");
  }

  const metadata = await pdf.getMetadata().catch(() => null);
  const info = (metadata?.info ?? {}) as PdfInfo;
  const title = normaliseSpace(info.Title ?? "") || fileTitle(file);
  const author = normaliseSpace(info.Author ?? "");
  const pageCount = pdf.numPages;
  const paragraphs: ReaderParagraph[] = [];
  const tocEntries = await collectTocEntries(pdf);
  const chapters = tocEntries.map((entry) =>
    `${entry.level > 0 ? `${"  ".repeat(Math.min(entry.level, 3))}` : ""}${entry.title}`
  );
  const chapterPageNumbers = tocEntries.map((entry) => entry.pageNumber);
  const chapterPageOffsets = tocEntries.map((entry) => entry.pageOffsetRatio);

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const pageText = await textFromPage(page);
    const pageParagraphs = splitPageText(pageText);
    const chapterIndex = chapterIndexForPage(tocEntries, pageNumber);
    const chapterTitle = tocEntries[chapterIndex]?.title ?? title;

    pageParagraphs.forEach((text, paragraphIndex) => {
      paragraphs.push({
        id: `pdf-${pageNumber}-${paragraphIndex}`,
        chapterIndex,
        chapterTitle,
        kind: "paragraph",
        pageNumber,
        text
      });
    });
  }

  await pdf.destroy();

  return {
    title,
    author,
    coverUrl: "",
    fileName: file.name,
    format: "pdf",
    pageCount,
    chapterPageNumbers,
    chapterPageOffsets,
    paragraphs,
    chapters
  };
};

export const readPdfPreview = async (file: File): Promise<PdfPreview> => {
  const bytes = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;

  try {
    const metadata = await pdf.getMetadata().catch(() => null);
    const info = (metadata?.info ?? {}) as PdfInfo;
    const title = normaliseSpace(info.Title ?? "") || fileTitle(file);
    const author = normaliseSpace(info.Author ?? "");
    const pageCount = pdf.numPages;
    const firstPage = await pdf.getPage(1).catch(() => null);
    const firstViewport = firstPage?.getViewport({ scale: 1 });
    const pageMetrics = firstViewport
      ? Array.from({ length: pageCount }, () => ({ height: firstViewport.height, width: firstViewport.width }))
      : [];
    const tocEntries = await collectTocEntries(pdf);

    return {
      author,
      chapterPageNumbers: tocEntries.map((entry) => entry.pageNumber),
      chapterPageOffsets: tocEntries.map((entry) => entry.pageOffsetRatio),
      chapters: tocEntries.map((entry) =>
        `${entry.level > 0 ? `${"  ".repeat(Math.min(entry.level, 3))}` : ""}${entry.title}`
      ),
      pageCount,
      pageMetrics,
      title
    };
  } finally {
    await pdf.destroy();
  }
};

export { pdfjsLib };
