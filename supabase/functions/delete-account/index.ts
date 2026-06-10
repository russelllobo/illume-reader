import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.106.0";

const EPUB_BUCKET = "epubs";
const READER_IMAGE_BUCKET = "reader-images";

const corsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const requiredEnv = (name: string) => {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};

const removeStorageObjects = async (
  adminClient: any,
  bucket: string,
  paths: string[],
) => {
  const uniquePaths = [...new Set(paths.filter(Boolean))];
  if (!uniquePaths.length) return 0;

  const { error } = await adminClient.storage.from(bucket).remove(uniquePaths);
  if (error) throw error;
  return uniquePaths.length;
};

const listStoragePaths = async (
  adminClient: any,
  table: string,
  userId: string,
) => {
  const { data, error } = await adminClient
    .from(table)
    .select("storage_path")
    .eq("user_id", userId);

  if (error) throw error;
  return (data ?? []).map((row: { storage_path: string | null }) =>
    row.storage_path ?? ""
  );
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const anonKey = requiredEnv("SUPABASE_ANON_KEY");
    const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const authorization = req.headers.get("Authorization");

    if (!authorization) throw new Error("Missing Authorization header");

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
    });
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: userData, error: userError } = await userClient.auth
      .getUser();

    if (userError || !userData.user) {
      throw new Error("You must be signed in to delete your account.");
    }

    const userId = userData.user.id;
    const [bookPaths, readerImagePaths] = await Promise.all([
      listStoragePaths(adminClient, "books", userId),
      listStoragePaths(adminClient, "reader_images", userId),
    ]);

    const [removedDocuments, removedReaderImages] = await Promise.all([
      removeStorageObjects(adminClient, EPUB_BUCKET, bookPaths),
      removeStorageObjects(adminClient, READER_IMAGE_BUCKET, readerImagePaths),
    ]);

    const { error: signOutError } = await userClient.auth.signOut();
    if (signOutError) throw signOutError;

    const { error: deleteError } = await adminClient.auth.admin.deleteUser(
      userId,
    );
    if (deleteError) throw deleteError;

    return new Response(
      JSON.stringify({
        deleted: true,
        removedDocuments,
        removedReaderImages,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error
          ? error.message
          : "Could not delete this account.",
      }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
