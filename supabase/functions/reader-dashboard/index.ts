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
  storage_path: string;
  title: string;
  user_id: string;
};

type ReaderImageRow = {
  book_id: string;
  created_at: string;
  end_word: number;
  id: string;
  prompt: string | null;
  start_word: number;
  storage_path: string;
  style: string | null;
  user_id: string;
};

type StorageObjectRow = {
  metadata: Record<string, unknown> | null;
  name: string;
};

type TimelineEvent = {
  booksBytes: number;
  booksCount: number;
  date: string;
  imagesBytes: number;
  imagesCount: number;
  usersCount: number;
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

const dateKey = (value: string | null | undefined) => {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return date.toISOString().slice(0, 10);
};

const storageFolderFor = (path: string) => {
  const parts = path.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
};

const listKnownStorageObjects = async (adminClient: any, bucket: string, paths: string[]) => {
  const uniquePaths = [...new Set(paths.filter(Boolean))];
  const objects: StorageObjectRow[] = [];

  await Promise.all(
    [...new Set(uniquePaths.map(storageFolderFor))].map(async (folder) => {
      const { data, error } = await adminClient.storage.from(bucket).list(folder, {
        limit: 1000,
        sortBy: { column: "name", order: "asc" }
      });

      if (error) throw error;

      for (const object of data ?? []) {
        if (!object.metadata) continue;
        const name = folder ? `${folder}/${object.name}` : object.name;
        if (uniquePaths.includes(name)) objects.push({ metadata: object.metadata, name });
      }
    })
  );

  return objects;
};

const createSignedUrlMap = async (adminClient: any, bucket: string, paths: string[]) => {
  const uniquePaths = [...new Set(paths.filter(Boolean))];
  const signedUrlMap = new Map<string, string>();

  for (let index = 0; index < uniquePaths.length; index += 100) {
    const batch = uniquePaths.slice(index, index + 100);
    const { data, error } = await adminClient.storage.from(bucket).createSignedUrls(batch, 60 * 60);
    if (error) throw error;

    (data ?? []).forEach((item: { path?: string; signedUrl?: string }, itemIndex: number) => {
      const path = item.path ?? batch[itemIndex];
      if (path && item.signedUrl) signedUrlMap.set(path, item.signedUrl);
    });
  }

  return signedUrlMap;
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

const buildTimeline = ({
  books,
  bookSizes,
  generatedAt,
  imageSizes,
  images,
  users
}: {
  books: BookRow[];
  bookSizes: Map<string, number>;
  generatedAt: string;
  imageSizes: Map<string, number>;
  images: ReaderImageRow[];
  users: Array<{ created_at?: string }>;
}) => {
  const events = new Map<string, TimelineEvent>();
  const ensureEvent = (date: string) => {
    const existing = events.get(date);
    if (existing) return existing;

    const event = { booksBytes: 0, booksCount: 0, date, imagesBytes: 0, imagesCount: 0, usersCount: 0 };
    events.set(date, event);
    return event;
  };

  users.forEach((user) => {
    const date = dateKey(user.created_at);
    if (date) ensureEvent(date).usersCount += 1;
  });

  books.forEach((book) => {
    const date = dateKey(book.created_at);
    if (!date) return;

    const event = ensureEvent(date);
    event.booksCount += 1;
    event.booksBytes += bookSizes.get(book.storage_path) ?? Number(book.file_size ?? 0);
  });

  images.forEach((image) => {
    const date = dateKey(image.created_at);
    if (!date) return;

    const event = ensureEvent(date);
    event.imagesCount += 1;
    event.imagesBytes += imageSizes.get(image.storage_path) ?? 0;
  });

  const today = dateKey(generatedAt);
  if (today) ensureEvent(today);

  const totals = { booksBytes: 0, booksCount: 0, imagesBytes: 0, imagesCount: 0, usersCount: 0 };

  return [...events.values()]
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((event) => {
      totals.booksBytes += event.booksBytes;
      totals.booksCount += event.booksCount;
      totals.imagesBytes += event.imagesBytes;
      totals.imagesCount += event.imagesCount;
      totals.usersCount += event.usersCount;

      return {
        booksBytes: totals.booksBytes,
        booksCount: totals.booksCount,
        date: event.date,
        imagesBytes: totals.imagesBytes,
        imagesCount: totals.imagesCount,
        storageBytes: totals.booksBytes + totals.imagesBytes,
        usersCount: totals.usersCount
      };
    });
};

const buildUserTimeline = ({
  books,
  bookSizes,
  generatedAt,
  imageSizes,
  images,
  user
}: {
  books: BookRow[];
  bookSizes: Map<string, number>;
  generatedAt: string;
  imageSizes: Map<string, number>;
  images: ReaderImageRow[];
  user: { created_at?: string };
}) =>
  buildTimeline({
    books,
    bookSizes,
    generatedAt,
    imageSizes,
    images,
    users: user.created_at ? [user] : []
  });

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
      { data: readerImages, error: readerImagesError }
    ] = await Promise.all([
      listAllUsers(adminClient),
      adminClient.from("books").select("created_at, document_type, file_name, file_size, id, storage_path, title, user_id"),
      adminClient
        .from("reader_images")
        .select("book_id, created_at, end_word, id, prompt, start_word, storage_path, style, user_id")
    ]);

    if (booksError) throw booksError;
    if (readerImagesError) throw readerImagesError;

    const bookRows = (books ?? []) as BookRow[];
    const imageRows = (readerImages ?? []) as ReaderImageRow[];
    const [bookObjects, imageObjects] = await Promise.all([
      listKnownStorageObjects(
        adminClient,
        BOOK_BUCKET,
        bookRows.map((book) => book.storage_path)
      ).catch(() => [] as StorageObjectRow[]),
      listKnownStorageObjects(
        adminClient,
        READER_IMAGE_BUCKET,
        imageRows.map((image) => image.storage_path)
      ).catch(() => [] as StorageObjectRow[])
    ]);
    const bookStorageFallback = bookRows.reduce((total, book) => total + Number(book.file_size ?? 0), 0);
    const bookStorageBytes = bookObjects.reduce((total, object) => total + objectSize(object), 0) || bookStorageFallback;
    const imageStorageBytes = imageObjects.reduce((total, object) => total + objectSize(object), 0);
    const bookSizeByPath = new Map(bookObjects.map((object) => [object.name, objectSize(object)]));
    const imageSizeByPath = new Map(imageObjects.map((object) => [object.name, objectSize(object)]));
    const imageSignedUrls = await createSignedUrlMap(
      adminClient,
      READER_IMAGE_BUCKET,
      imageRows.map((image) => image.storage_path)
    ).catch(() => new Map<string, string>());
    const bookTitlesById = new Map(bookRows.map((book) => [book.id, book.title]));
    const generatedAt = new Date().toISOString();
    const timeline = buildTimeline({
      books: bookRows,
      bookSizes: bookSizeByPath,
      generatedAt,
      imageSizes: imageSizeByPath,
      images: imageRows,
      users
    });

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
        images: userImages
          .sort((left, right) => right.created_at.localeCompare(left.created_at))
          .map((image) => ({
            bookId: image.book_id,
            bookTitle: bookTitlesById.get(image.book_id) ?? "Unknown book",
            createdAt: image.created_at,
            endWord: image.end_word,
            id: image.id,
            prompt: image.prompt,
            signedUrl: imageSignedUrls.get(image.storage_path) ?? null,
            startWord: image.start_word,
            style: image.style ?? "cartoon"
          })),
        imagesGenerated: userImages.length,
        timeline: buildUserTimeline({
          books: userBooks,
          bookSizes: bookSizeByPath,
          generatedAt,
          imageSizes: imageSizeByPath,
          images: userImages,
          user
        })
      };
    });

    return jsonResponse({
      generatedAt,
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
      timeline,
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
