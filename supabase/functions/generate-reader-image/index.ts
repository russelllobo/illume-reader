import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.106.0";

const READER_IMAGE_BUCKET = "reader-images";
const READER_IMAGE_ACCOUNT_LIMIT = 100;

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

const cleanText = (value: unknown, maxLength: number) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);

const cleanId = (value: unknown, maxLength = 80) =>
  String(value ?? "")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, maxLength);

const imagePathFor = (userId: string, bookId: string, startWord: number, endWord: number) =>
  `${userId}/${bookId}/${startWord}-${endWord}.webp`;

const base64ToBytes = (base64: string) => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
};

const imageDataUrl = (base64: string) => `data:image/webp;base64,${base64}`;

const readerImageCount = async (adminClient: any, userId: string) => {
  const { count, error } = await adminClient
    .from("reader_images")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  if (error) throw error;
  return count ?? 0;
};

const getStoredReaderImage = async (
  adminClient: any,
  userId: string,
  bookId: string,
  startWord: number,
  endWord: number
) => {
  const downloadStoredImage = async (image: { prompt: string | null; storage_path: string | null }) => {
    if (!image.storage_path) return null;

    const { data: blob, error: downloadError } = await adminClient.storage
      .from(READER_IMAGE_BUCKET)
      .download(image.storage_path);

    if (downloadError || !blob) return null;

    const bytes = new Uint8Array(await blob.arrayBuffer());
    return {
      imageUrl: imageDataUrl(bytesToBase64(bytes)),
      prompt: image.prompt ?? undefined
    };
  };

  const { data: exactImage, error: exactError } = await adminClient
    .from("reader_images")
    .select("prompt, storage_path")
    .eq("user_id", userId)
    .eq("book_id", bookId)
    .eq("start_word", startWord)
    .eq("end_word", endWord)
    .maybeSingle();

  if (exactError) throw exactError;
  if (exactImage?.storage_path) return downloadStoredImage(exactImage);

  const { data: overlappingImages, error: overlapError } = await adminClient
    .from("reader_images")
    .select("end_word, prompt, start_word, storage_path")
    .eq("user_id", userId)
    .eq("book_id", bookId)
    .lte("start_word", endWord)
    .gte("end_word", startWord);

  if (overlapError) throw overlapError;

  const closestImage = (overlappingImages ?? [])
    .filter((image: { storage_path: string | null }) => image.storage_path)
    .sort(
      (
        left: { end_word: number; start_word: number },
        right: { end_word: number; start_word: number }
      ) => {
        const leftOverlap = Math.min(left.end_word, endWord) - Math.max(left.start_word, startWord);
        const rightOverlap = Math.min(right.end_word, endWord) - Math.max(right.start_word, startWord);
        if (rightOverlap !== leftOverlap) return rightOverlap - leftOverlap;
        return Math.abs(left.start_word - startWord) - Math.abs(right.start_word - startWord);
      }
    )[0];

  return closestImage ? downloadStoredImage(closestImage) : null;
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
    const openAiKey = requiredEnv("OPENAI_API_KEY");
    const authorization = req.headers.get("Authorization");

    if (!authorization) throw new Error("Missing Authorization header");

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } }
    });
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: userData, error: userError } = await userClient.auth.getUser();

    if (userError || !userData.user) throw new Error("You must be signed in to generate images.");

    const payload = await req.json();
    const bookId = cleanId(payload.bookId);
    const bookTitle = cleanText(payload.bookTitle, 180);
    const text = cleanText(payload.text, 7_500);
    const startWord = Number(payload.startWord);
    const endWord = Number(payload.endWord);

    if (!bookId) throw new Error("No book was provided for image generation.");
    if (!text) throw new Error("No reading text was provided for image generation.");
    if (!Number.isFinite(startWord) || !Number.isFinite(endWord)) {
      throw new Error("A valid word range is required for image generation.");
    }

    const { data: book, error: bookError } = await userClient
      .from("books")
      .select("id")
      .eq("id", bookId)
      .eq("user_id", userData.user.id)
      .maybeSingle();

    if (bookError) throw bookError;
    if (!book) throw new Error("You can only generate images for your own books.");

    const storedImage = await getStoredReaderImage(adminClient, userData.user.id, bookId, startWord, endWord);
    if (storedImage) {
      return new Response(
        JSON.stringify({
          ...storedImage,
          cached: true,
          imageCount: await readerImageCount(adminClient, userData.user.id),
          imageLimit: READER_IMAGE_ACCOUNT_LIMIT
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: billingProfile, error: billingError } = await adminClient
      .from("billing_profiles")
      .select("plan, status")
      .eq("user_id", userData.user.id)
      .maybeSingle();

    if (billingError) throw billingError;
    if (billingProfile?.plan !== "pro" || !["active", "trialing"].includes(billingProfile.status)) {
      throw new Error("Image generation is available on the Pro plan.");
    }

    const imageCount = await readerImageCount(adminClient, userData.user.id);
    if (imageCount >= READER_IMAGE_ACCOUNT_LIMIT) {
      throw new Error(`Image generation limit reached (${READER_IMAGE_ACCOUNT_LIMIT} images).`);
    }

    const prompt = [
      "Create a clever visual explanation of this nonfiction paragraph as if it were an illustrated idea from a bestselling self-development book.",
      `Book: ${bookTitle || "Uploaded document"}.`,
      `Paragraph: ${text}`,
      "",
      "First, silently pick:",
      "A concise main idea.",
      "Identify:",
      "1) The emotional or practical shift.",
      "2) One simple visual metaphor that captures it.",
      "Then create the image using that metaphor.",
      "",
      "The image should have:",
      "- MINIMAL text",
      "- prioritise instant intuitiveness",
      "- 1 simple idea in bold Sunday funnies style with thick outlines, halftone textures, and bright 1980s colors that explains the concept instantly. Avoid displaying too much information.",
      "- A clear before/after or problem/solution contrast only if suitable",
      "- Expressive human body language or facial expressions where useful.",
      "- Bright, inviting colors.",
      "",
      "Style: Playful premium editorial illustration, bold shapes, warm lighting, crisp details, slightly exaggerated expressions, modern nonfiction-book visual style. Fun but not childish. Clear but not boring. Make the lesson land visually without needing the viewer to read a long explanation.",
      Number.isFinite(startWord) && Number.isFinite(endWord) ? `Reference words: ${startWord}-${endWord}.` : ""
    ]
      .filter((line) => line !== "")
      .join("\n");

    const response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-image-2",
        n: 1,
        output_compression: 78,
        output_format: "webp",
        prompt,
        quality: "low",
        size: "1024x1536"
      })
    });

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result?.error?.message ?? "OpenAI image generation failed.");
    }

    const base64Image = result?.data?.[0]?.b64_json;
    if (!base64Image) throw new Error("OpenAI returned no image data.");
    const storagePath = imagePathFor(userData.user.id, bookId, startWord, endWord);

    const { error: uploadError } = await adminClient.storage
      .from(READER_IMAGE_BUCKET)
      .upload(storagePath, base64ToBytes(base64Image), {
        contentType: "image/webp",
        upsert: true
      });

    if (uploadError) throw uploadError;

    const { error: insertError } = await adminClient.from("reader_images").upsert(
      {
        book_id: bookId,
        end_word: endWord,
        prompt,
        start_word: startWord,
        storage_path: storagePath,
        user_id: userData.user.id
      },
      { onConflict: "book_id,start_word,end_word" }
    );

    if (insertError) throw insertError;

    return new Response(
      JSON.stringify({
        cached: false,
        imageCount: imageCount + 1,
        imageLimit: READER_IMAGE_ACCOUNT_LIMIT,
        imageUrl: imageDataUrl(base64Image),
        prompt
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Could not generate image." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
