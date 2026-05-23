import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.106.0";

const ADMIN_EMAIL = "r.lobo2003@gmail.com";
const BOOK_BUCKET = "epubs";
const READER_IMAGE_BUCKET = "reader-images";

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS"
};

type BookRow = {
  created_at: string;
  document_type: string | null;
  file_name: string;
  file_size: number | null;
  id: string;
  title: string;
  user_id: string;
};

type ReaderImageRow = {
  book_id: string;
  created_at: string;
  id: string;
  storage_path: string;
  user_id: string;
};

type StorageObjectRow = {
  bucket_id: string;
  metadata: Record<string, unknown> | null;
  name: string;
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

const objectOwnerId = (name: string) => name.split("/").filter(Boolean)[0] ?? "";

const objectSize = (object: StorageObjectRow) => {
  const rawSize = object.metadata?.size;
  const size = typeof rawSize === "number" ? rawSize : Number(rawSize ?? 0);
  return Number.isFinite(size) ? size : 0;
};

const listAllUsers = async (adminClient: any) => {
  const users: Array<{ id: string; email?: string; created_at?: string }> = [];
  const perPage = 1000;

  for (let page = 1; page < 1000; page += 1) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage });
    if (error) throw error;

    users.push(...(data?.users ?? []));
    if (!data?.users?.length || data.users.length < perPage) break;
  }

  return users;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const anonKey = requiredEnv("SUPABASE_ANON_KEY");
    const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const authorization = req.headers.get("Authorization");

    if (!authorization) return jsonResponse({ error: "Sign in with Google to view this dashboard." }, 401);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } }
    });
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: userData, error: userError } = await userClient.auth.getUser();

    if (userError || !userData.user) return jsonResponse({ error: "Sign in with Google to view this dashboard." }, 401);
    if ((userData.user.email ?? "").toLowerCase() !== ADMIN_EMAIL) {
      return jsonResponse({ error: "This dashboard is only available to the reader project owner." }, 403);
    }

    const [
      users,
      { data: books, error: booksError },
      { data: readerImages, error: readerImagesError },
      { data: storageObjects, error: storageObjectsError }
    ] = await Promise.all([
      listAllUsers(adminClient),
      adminClient.from("books").select("created_at, document_type, file_name, file_size, id, title, user_id"),
      adminClient.from("reader_images").select("book_id, created_at, id, storage_path, user_id"),
      adminClient
        .schema("storage")
        .from("objects")
        .select("bucket_id, metadata, name")
        .in("bucket_id", [BOOK_BUCKET, READER_IMAGE_BUCKET])
    ]);

    if (booksError) throw booksError;
    if (readerImagesError) throw readerImagesError;
    if (storageObjectsError) throw storageObjectsError;

    const bookRows = (books ?? []) as BookRow[];
    const imageRows = (readerImages ?? []) as ReaderImageRow[];
    const objectRows = (storageObjects ?? []) as StorageObjectRow[];
    const bookObjects = objectRows.filter((object) => object.bucket_id === BOOK_BUCKET);
    const imageObjects = objectRows.filter((object) => object.bucket_id === READER_IMAGE_BUCKET);
    const bookStorageFallback = bookRows.reduce((total, book) => total + Number(book.file_size ?? 0), 0);
    const bookStorageBytes = bookObjects.reduce((total, object) => total + objectSize(object), 0) || bookStorageFallback;
    const imageStorageBytes = imageObjects.reduce((total, object) => total + objectSize(object), 0);

    const byUser = users.map((user) => {
      const userBooks = bookRows.filter((book) => book.user_id === user.id);
      const userImages = imageRows.filter((image) => image.user_id === user.id);
      const userBookObjectBytes = bookObjects
        .filter((object) => objectOwnerId(object.name) === user.id)
        .reduce((total, object) => total + objectSize(object), 0);
      const userImageObjectBytes = imageObjects
        .filter((object) => objectOwnerId(object.name) === user.id)
        .reduce((total, object) => total + objectSize(object), 0);

      return {
        bookStorageBytes: userBookObjectBytes || userBooks.reduce((total, book) => total + Number(book.file_size ?? 0), 0),
        books: userBooks
          .sort((left, right) => right.created_at.localeCompare(left.created_at))
          .map((book) => ({
            createdAt: book.created_at,
            documentType: book.document_type ?? (book.file_name.toLowerCase().endsWith(".pdf") ? "pdf" : "epub"),
            fileName: book.file_name,
            fileSize: Number(book.file_size ?? 0),
            id: book.id,
            title: book.title
          })),
        createdAt: user.created_at ?? null,
        email: user.email ?? "No email",
        id: user.id,
        imageStorageBytes: userImageObjectBytes,
        imagesGenerated: userImages.length
      };
    });

    return jsonResponse({
      generatedAt: new Date().toISOString(),
      storage: {
        booksBytes: bookStorageBytes,
        imagesBytes: imageStorageBytes,
        totalBytes: bookStorageBytes + imageStorageBytes
      },
      totals: {
        books: bookRows.length,
        imagesGenerated: imageRows.length,
        users: users.length
      },
      users: byUser.sort((left, right) => {
        const rightCreatedAt = right.createdAt ?? "";
        const leftCreatedAt = left.createdAt ?? "";
        return rightCreatedAt.localeCompare(leftCreatedAt);
      })
    });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Could not load the reader dashboard." },
      400
    );
  }
});
