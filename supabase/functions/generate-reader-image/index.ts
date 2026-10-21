import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.106.0";

const READER_IMAGE_BUCKET = "reader-images";
// Image rendering: Recraft V4.1 Flash first (~$0.007/image, ~1.3s),
// GPT Image 2.5 Flare as the only fallback. Nothing else.
const OPENROUTER_IMAGE_URL = "https://openrouter.ai/api/v1/images";
const IMAGE_PRIMARY_MODEL = "recraft/recraft-v4.1-flash";
const IMAGE_FALLBACK_MODEL = "openai/gpt-image-2.5-flare";
const FREE_READER_IMAGE_LIFETIME_LIMIT = 25;
const PRO_READER_IMAGE_MONTHLY_LIMIT = 1000;
// Accepted for cache-key compatibility with existing rows; ignored in the
// prompt (there is a single look, no style selector anymore).
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
) => `${userId}/${bookId}/${style}/${startWord}-${endWord}.png`;

// The entire prompt architecture: one fixed illustrator instruction plus the
// raw 200-word section text. No prompt-writing LLM, no style suffixes.
const buildImagePrompt = (bookTitle: string, text: string) =>
  [
    `You are a book illustrator. Create a visual aid that will appear for this section in the book ${bookTitle || "Uploaded document"}. Don't include text in the picture.`,
    "",
    "Section:",
    text,
  ].join("\n");

const base64ToBytes = (base64: string) => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
};

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

const sseEncode = (event: string, data: unknown) =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

// Calls the OpenRouter Images API (buffered, no partials). Resolves with the
// image plus the billed cost in USD (from `usage.cost` when reported).
// Recraft Flash only supports portrait via 9:16; Flare supports 2:3.
const renderViaOpenRouter = async (
  openRouterKey: string,
  model: string,
  prompt: string
): Promise<{ b64: string; cost: number | null; mediaType: string }> => {
  const aspect_ratio = model.startsWith("recraft/") ? "9:16" : "2:3";
  const response = await fetch(OPENROUTER_IMAGE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openRouterKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      aspect_ratio,
      model,
      n: 1,
      output_format: "png",
      prompt
    })
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      (result?.error as { message?: unknown })?.message ??
      `OpenRouter image call failed (${response.status})`;
    throw new Error(typeof message === "string" ? message : "OpenRouter image call failed.");
  }
  const b64 = result?.data?.[0]?.b64_json;
  if (!b64) throw new Error("Image model returned no image data.");
  const cost = typeof result?.usage?.cost === "number" ? result.usage.cost : null;
  const mediaType =
    typeof result?.data?.[0]?.media_type === "string" ? result.data[0].media_type : "image/png";
  return { b64, cost, mediaType };
};

// Tries Recraft Flash first, then Flare once. Returns the winning model,
// image, and billed cost. Throws the last error.
const renderImage = async (
  openRouterKey: string,
  prompt: string
): Promise<{ b64: string; cost: number | null; imageModel: string; mediaType: string }> => {
  let lastError: unknown = null;
  for (const model of [IMAGE_PRIMARY_MODEL, IMAGE_FALLBACK_MODEL]) {
    try {
      const { b64, cost, mediaType } = await renderViaOpenRouter(openRouterKey, model, prompt);
      console.log(
        `Reader image rendered with ${model}${typeof cost === "number" ? ` ($${cost})` : ""}`
      );
      return { b64, cost, imageModel: model, mediaType };
    } catch (error) {
      console.warn(`OpenRouter ${model} failed, trying next`, errorMessage(error));
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Image generation failed.");
};

const imageDataUrlFor = (mediaType: string, base64: string) => `data:${mediaType};base64,${base64}`;

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
      imageUrl: imageDataUrlFor("image/png", bytesToBase64(bytes)),
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
    const openRouterKey = Deno.env.get("OPENROUTER_API_KEY") ?? "";
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
    const text = cleanText(payload.text, 12_000);
    const startWord = Number(payload.startWord);
    const endWord = Number(payload.endWord);
    const checkOnly = payload.checkOnly === true;
    const promptOnly = payload.promptOnly === true;

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

    const prompt = buildImagePrompt(bookTitle, text);
    const promptSource = "simple";

    // Compat for older clients that pre-warmed prompts: return the prompt
    // directly without rendering an image or spending quota.
    if (promptOnly) {
      return new Response(
        JSON.stringify({
          cached: false,
          imageCount: await readerImageUsageSnapshot(adminClient, userData.user.id, activePlan),
          imageLimit,
          plan: activePlan,
          prompt,
          promptSource
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
      if (payload.stream === true) {
        const streamUserId = userData.user.id;
        const streamBookId = bookId;
        const streamStyle = imageStyle;
        const streamStartWord = startWord;
        const streamEndWord = endWord;
        const stream = new ReadableStream({
          async start(controller) {
            const send = (event: string, data: unknown) => {
              controller.enqueue(new TextEncoder().encode(sseEncode(event, data)));
            };
            const refund = async () => {
              const { error: refundError } = await adminClient.rpc("refund_reader_image_generation", {
                p_period_start: usagePeriodStart,
                p_resets_monthly: usageResetsMonthly,
                p_user_id: streamUserId
              });
              if (refundError) console.error("Failed to refund reader image generation", refundError);
            };
            try {
              send("prompt", { prompt, promptSource });
              if (!openRouterKey) throw new Error("No image API key configured.");
              const rendered = await renderImage(openRouterKey, prompt);
              const storagePath = imagePathFor(streamUserId, streamBookId, streamStyle, streamStartWord, streamEndWord);
              const { error: uploadError } = await adminClient.storage
                .from(READER_IMAGE_BUCKET)
                .upload(storagePath, base64ToBytes(rendered.b64), {
                  contentType: rendered.mediaType,
                  upsert: true
                });
              if (uploadError) throw uploadError;
              const { error: insertError } = await adminClient.from("reader_images").upsert(
                {
                  book_id: streamBookId,
                  end_word: streamEndWord,
                  prompt,
                  start_word: streamStartWord,
                  storage_path: storagePath,
                  style: streamStyle,
                  user_id: streamUserId
                },
                { onConflict: "book_id,start_word,end_word,style" }
              );
              if (insertError) throw insertError;
              const finalImageCount = await readerImageUsageSnapshot(adminClient, streamUserId, activePlan);
              send("final", {
                cached: false,
                imageCost: rendered.cost,
                imageCount: finalImageCount,
                imageLimit,
                imageModel: rendered.imageModel,
                imageUrl: imageDataUrlFor(rendered.mediaType, rendered.b64),
                plan: activePlan,
                prompt,
                promptSource
              });
              controller.close();
            } catch (error) {
              await refund();
              console.error("generate-reader-image stream failed", error);
              send("error", { error: errorMessage(error) });
              controller.close();
            }
          }
        });
        return new Response(stream, {
          headers: {
            ...corsHeaders,
            "Cache-Control": "no-cache",
            "Content-Type": "text/event-stream"
          }
        });
      }

      if (!openRouterKey) throw new Error("No image API key configured.");
      const rendered = await renderImage(openRouterKey, prompt);
      const storagePath = imagePathFor(userData.user.id, bookId, imageStyle, startWord, endWord);

      const { error: uploadError } = await adminClient.storage
        .from(READER_IMAGE_BUCKET)
        .upload(storagePath, base64ToBytes(rendered.b64), {
          contentType: rendered.mediaType,
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
          imageCost: rendered.cost,
          imageCount: finalImageCount,
          imageLimit,
          imageModel: rendered.imageModel,
          imageUrl: imageDataUrlFor(rendered.mediaType, rendered.b64),
          plan: activePlan,
          prompt,
          promptSource
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
