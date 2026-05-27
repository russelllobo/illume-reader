import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.106.0";

const READER_IMAGE_BUCKET = "reader-images";
const FREE_READER_IMAGE_LIFETIME_LIMIT = 25;
const PRO_READER_IMAGE_MONTHLY_LIMIT = 1000;
type ReaderImageStyle = "cartoon" | "cute";

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

const cleanImageStyle = (value: unknown): ReaderImageStyle =>
  value === "cute" ? "cute" : "cartoon";

const imagePathFor = (
  userId: string,
  bookId: string,
  style: ReaderImageStyle,
  startWord: number,
  endWord: number
) => `${userId}/${bookId}/${style}/${startWord}-${endWord}.webp`;

const promptForStyle = (
  style: ReaderImageStyle,
  bookTitle: string,
  text: string
) => {
  const promptLines =
    style === "cute"
      ? [
          "Create a clever visual picture for this paragraph as if it were an illustration from a bestselling book.",
          `Book: ${bookTitle || "Uploaded document"}.`,
          `Paragraph: ${text}`,
          "",
          "First, silently identify:",
          "The type of book: non-fiction, biography , fiction etc",
          "Pick:",
          "A concise main idea/story",
          "Identify:",
          "1) The emotional or practical shift.",
          "Then create the image using shift.",
          "",
          "The image should have:",
          "- MINIMAL text",
          "- 1 simple idea in kawaii anime style with soft rounded shapes, pastel modern colors, and a charming storybook feel that explains the concept instantly. Avoid displaying too much information.",
          "- A clear before/after or problem/solution contrast only if suitable",
          "- Expressive cute animals, gentle characters, or adorable facial expressions where useful.",
          "- Bright pastel, inviting colors.",
          "",
          "Style: Playful premium kawaii editorial illustration, soft shapes, warm lighting, crisp details, slightly exaggerated expressions, modern cute-book visual style. Fun but not childish. Clear but not boring. Make the idea/story land visually, enhancing the text."
        ]
      : [
          "Create a clever visual picture for this paragraph as if it were an illustration from a bestselling book.",
          `Book: ${bookTitle || "Uploaded document"}.`,
          `Paragraph: ${text}`,
          "",
          "First, silently identify:",
          "The type of book: non-fiction, biography , fiction etc",
          "Pick:",
          "A concise main idea/story",
          "Identify:",
          "1) The emotional or practical shift.",
          "Then create the image using shift.",
          "",
          "The image should have:",
          "- MINIMAL text",
          "- 1 simple idea in bold Sunday funnies style with thick outlines, halftone textures, and bright 1980s colors that explains the concept instantly. Avoid displaying too much information.",
          "- A clear before/after or problem/solution contrast only if suitable",
          "- Expressive human body language or facial expressions where useful.",
          "- Bright, inviting colors.",
          "",
          "Style: Playful premium editorial illustration, bold shapes, warm lighting, crisp details, slightly exaggerated expressions, modern nonfiction-book visual style. Fun but not childish. Clear but not boring. Make the lesson land visually without needing the viewer to read a long explanation."
        ];

  return promptLines.filter((line) => line !== "").join("\n");
};

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

const currentMonthStart = () => new Date().toISOString().slice(0, 7) + "-01";

const errorMessage = (error: unknown, fallback = "Could not generate image.") => {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const value = error as {
      code?: unknown;
      details?: unknown;
      error?: unknown;
      error_description?: unknown;
      hint?: unknown;
      message?: unknown;
    };
    const message =
      typeof value.message === "string"
        ? value.message
        : typeof value.error_description === "string"
          ? value.error_description
          : typeof value.error === "string"
            ? value.error
            : "";
    const details = typeof value.details === "string" ? value.details : "";
    const hint = typeof value.hint === "string" ? value.hint : "";
    const code = typeof value.code === "string" ? value.code : "";
    const parts = [message, details, hint].filter(Boolean);

    if (parts.length) return parts.join(" ");
    if (code) return `Supabase error ${code}`;
  }

  return fallback;
};

const openAiImageErrorMessage = (status: number, result: unknown) => {
  const rawMessage =
    result && typeof result === "object" && "error" in result
      ? (result.error as { message?: unknown }).message
      : undefined;
  const message = typeof rawMessage === "string" ? rawMessage : "";
  const normalized = message.toLowerCase();

  if (
    status === 429 ||
    normalized.includes("rate limit reached") ||
    normalized.includes("rate_limit") ||
    normalized.includes("platform.openai.com/account/rate-limits")
  ) {
    return "Image generation is busy. Please try again in a moment.";
  }

  return message || "OpenAI image generation failed.";
};

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

const readerImageUsageSnapshot = async (adminClient: any, userId: string, plan: "free" | "pro") => {
  const periodStart = currentMonthStart();
  const { data, error } = await adminClient
    .from("reader_image_usage")
    .select("generated_count, monthly_generated_count, monthly_period_start")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  const [totalRows, monthlyRows] = await Promise.all([
    readerImageRowCount(adminClient, userId),
    plan === "pro" ? readerImageRowCount(adminClient, userId, periodStart) : Promise.resolve(0)
  ]);
  const generatedCount = Math.max(data?.generated_count ?? 0, totalRows);
  const monthlyGeneratedCount =
    data?.monthly_period_start === periodStart
      ? Math.max(data?.monthly_generated_count ?? 0, monthlyRows)
      : monthlyRows;

  const { error: syncError } = await adminClient
    .from("reader_image_usage")
    .upsert({
      generated_count: generatedCount,
      monthly_generated_count: monthlyGeneratedCount,
      monthly_period_start: periodStart,
      user_id: userId
    });

  if (syncError) throw syncError;

  if (plan === "pro") {
    return monthlyGeneratedCount;
  }
  return generatedCount;
};

const limitResponse = (
  plan: "free" | "pro",
  imageCount: number,
  imageLimit: number
) =>
  new Response(
    JSON.stringify({
      code: "reader_image_limit_reached",
      imageCount,
      imageLimit,
      limitReached: true,
      plan,
      upgradeRequired: plan === "free"
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );

const getStoredReaderImage = async (
  adminClient: any,
  userId: string,
  bookId: string,
  style: ReaderImageStyle,
  startWord: number,
  endWord: number
) => {
  const downloadStoredImage = async (storagePath: string | null, prompt: string | null) => {
    if (!storagePath) return null;

    const { data: blob, error: downloadError } = await adminClient.storage
      .from(READER_IMAGE_BUCKET)
      .download(storagePath);

    if (downloadError || !blob) return null;

    const bytes = new Uint8Array(await blob.arrayBuffer());
    return {
      imageUrl: imageDataUrl(bytesToBase64(bytes)),
      prompt: prompt ?? undefined
    };
  };
  const expectedStoragePath = imagePathFor(userId, bookId, style, startWord, endWord);

  const { data: exactImage, error: exactError } = await adminClient
    .from("reader_images")
    .select("prompt, storage_path")
    .eq("user_id", userId)
    .eq("book_id", bookId)
    .eq("style", style)
    .eq("start_word", startWord)
    .eq("end_word", endWord)
    .maybeSingle();

  if (exactError) throw exactError;
  if (exactImage?.storage_path) {
    const storedImage = await downloadStoredImage(exactImage.storage_path, exactImage.prompt);
    if (storedImage) return storedImage;
  }

  const imageAtExpectedPath = await downloadStoredImage(expectedStoragePath, exactImage?.prompt ?? null);
  if (imageAtExpectedPath) {
    const { error: upsertError } = await adminClient.from("reader_images").upsert(
      {
        book_id: bookId,
        end_word: endWord,
        prompt: exactImage?.prompt ?? null,
        start_word: startWord,
        storage_path: expectedStoragePath,
        style,
        user_id: userId
      },
      { onConflict: "book_id,start_word,end_word,style" }
    );

    if (upsertError) {
      console.warn("Found reader image in storage but could not repair metadata", upsertError);
    }

    return imageAtExpectedPath;
  }

  return null;
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
    const imageStyle = cleanImageStyle(payload.imageStyle ?? payload.style);
    const text = cleanText(payload.text, 7_500);
    const startWord = Number(payload.startWord);
    const endWord = Number(payload.endWord);
    const checkOnly = payload.checkOnly === true;

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

    const { data: billingProfile, error: billingError } = await adminClient
      .from("billing_profiles")
      .select("plan, status")
      .eq("user_id", userData.user.id)
      .maybeSingle();

    if (billingError) throw billingError;
    const activePlan =
      billingProfile?.plan === "pro" && ["active", "trialing"].includes(billingProfile.status)
        ? "pro"
        : "free";
    const imageLimit = activePlan === "pro" ? PRO_READER_IMAGE_MONTHLY_LIMIT : FREE_READER_IMAGE_LIFETIME_LIMIT;
    const usageResetsMonthly = activePlan === "pro";
    const usagePeriodStart = currentMonthStart();
    await readerImageUsageSnapshot(adminClient, userData.user.id, activePlan);

    const storedImage = await getStoredReaderImage(adminClient, userData.user.id, bookId, imageStyle, startWord, endWord);
    if (storedImage) {
      return new Response(
        JSON.stringify({
          ...storedImage,
          cached: true,
          imageCount: await readerImageUsageSnapshot(adminClient, userData.user.id, activePlan),
          imageLimit,
          plan: activePlan
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (checkOnly) {
      return new Response(
        JSON.stringify({
          cached: false,
          exists: false,
          imageCount: await readerImageUsageSnapshot(adminClient, userData.user.id, activePlan),
          imageLimit,
          plan: activePlan
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: reservation, error: reservationError } = await adminClient.rpc(
      "reserve_reader_image_generation",
      {
        p_image_limit: imageLimit,
        p_period_start: usagePeriodStart,
        p_resets_monthly: usageResetsMonthly,
        p_user_id: userData.user.id
      }
    );

    if (reservationError) throw reservationError;
    const usageReservation = Array.isArray(reservation) ? reservation[0] : reservation;
    const imageCount = Number(usageReservation?.generated_count ?? imageLimit);
    const generationReserved = Boolean(usageReservation?.allowed);

    if (!generationReserved) {
      return limitResponse(activePlan, imageCount, imageLimit);
    }

    try {
      const prompt = promptForStyle(imageStyle, bookTitle, text);

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
        throw new Error(openAiImageErrorMessage(response.status, result));
      }

      const base64Image = result?.data?.[0]?.b64_json;
      if (!base64Image) throw new Error("OpenAI returned no image data.");
      const storagePath = imagePathFor(userData.user.id, bookId, imageStyle, startWord, endWord);

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
          style: imageStyle,
          user_id: userData.user.id
        },
        { onConflict: "book_id,start_word,end_word,style" }
      );

      if (insertError) throw insertError;

      const finalImageCount = await readerImageUsageSnapshot(adminClient, userData.user.id, activePlan);

      return new Response(
        JSON.stringify({
          cached: false,
          imageCount: finalImageCount,
          imageLimit,
          imageUrl: imageDataUrl(base64Image),
          plan: activePlan,
          prompt
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (error) {
      const { error: refundError } = await adminClient.rpc("refund_reader_image_generation", {
        p_period_start: usagePeriodStart,
        p_resets_monthly: usageResetsMonthly,
        p_user_id: userData.user.id
      });
      if (refundError) {
        console.error("Failed to refund reader image generation", refundError);
      }
      throw error;
    }
  } catch (error) {
    console.error("generate-reader-image failed", error);
    return new Response(
      JSON.stringify({ error: errorMessage(error) }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
