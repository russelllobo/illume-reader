import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.106.0";

const EPUB_BUCKET = "epubs";
const READER_IMAGE_BUCKET = "reader-images";

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const requiredEnv = (name: string) => {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};

const cleanId = (value: unknown, maxLength = 80) =>
  String(value ?? "")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, maxLength);

const removeStorageObjects = async (adminClient: any, bucket: string, paths: string[]) => {
  const uniquePaths = [...new Set(paths.filter(Boolean))];
  if (!uniquePaths.length) return 0;

  const { error } = await adminClient.storage.from(bucket).remove(uniquePaths);
  if (error) throw error;
  return uniquePaths.length;
};

const currentMonthStart = () => new Date().toISOString().slice(0, 7) + "-01";

const readerImageRowCount = async (adminClient: any, userId: string, periodStart?: string) => {
  let query = adminClient
    .from("reader_images")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  if (periodStart) query = query.gte("created_at", periodStart);

  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
};

const preserveReaderImageUsage = async (adminClient: any, userId: string) => {
  const periodStart = currentMonthStart();
  const [{ data: usage, error: usageError }, totalRows, monthlyRows] = await Promise.all([
    adminClient
      .from("reader_image_usage")
      .select("generated_count, monthly_generated_count, monthly_period_start")
      .eq("user_id", userId)
      .maybeSingle(),
    readerImageRowCount(adminClient, userId),
    readerImageRowCount(adminClient, userId, periodStart)
  ]);

  if (usageError) throw usageError;

  const generatedCount = Math.max(usage?.generated_count ?? 0, totalRows);
  const monthlyGeneratedCount =
    usage?.monthly_period_start === periodStart
      ? Math.max(usage?.monthly_generated_count ?? 0, monthlyRows)
      : monthlyRows;

  const { error } = await adminClient
    .from("reader_image_usage")
    .upsert({
      generated_count: generatedCount,
      monthly_generated_count: monthlyGeneratedCount,
      monthly_period_start: periodStart,
      user_id: userId
    });

  if (error) throw error;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

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

    if (userError || !userData.user) throw new Error("You must be signed in to delete books.");

    const payload = await req.json();
    const bookId = cleanId(payload.bookId);
    if (!bookId) throw new Error("No book was provided for deletion.");

    const { data: book, error: bookError } = await userClient
      .from("books")
      .select("id, storage_path")
      .eq("id", bookId)
      .eq("user_id", userData.user.id)
      .maybeSingle();

    if (bookError) throw bookError;
    if (!book) throw new Error("You can only delete your own books.");

    const { data: readerImages, error: readerImagesError } = await adminClient
      .from("reader_images")
      .select("storage_path")
      .eq("book_id", bookId)
      .eq("user_id", userData.user.id);

    if (readerImagesError) throw readerImagesError;

    await preserveReaderImageUsage(adminClient, userData.user.id);

    const removedEpubs = await removeStorageObjects(adminClient, EPUB_BUCKET, [book.storage_path]);
    let removedReaderImages = 0;

    try {
      removedReaderImages = await removeStorageObjects(
        adminClient,
        READER_IMAGE_BUCKET,
        (readerImages ?? []).map((image: { storage_path: string | null }) => image.storage_path ?? "")
      );
    } catch (cleanupError) {
      console.warn("Could not remove reader image files while deleting book:", cleanupError);
    }

    const { error: deleteError } = await adminClient
      .from("books")
      .delete()
      .eq("id", bookId)
      .eq("user_id", userData.user.id);

    if (deleteError) throw deleteError;

    return new Response(
      JSON.stringify({
        deleted: true,
        removedEpubs,
        removedReaderImages
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Could not delete this book." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
