import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.106.0";

const SPEECHIFY_SPEECH_URL = "https://api.speechify.ai/v1/audio/speech";
const DEFAULT_VOICE = "geffen_32";
const DEFAULT_MODEL = "simba-3.2";
const DEFAULT_FORMAT = "mp3";
// Speechify speech endpoint accepts up to 2,000 characters per request.
const MAX_TEXT_LENGTH = 2_000;

// Single-voice setup: Geffen only. Extra ids are accepted as aliases and
// mapped to geffen_32 so older saved voices keep working.
const allowedVoices = new Set([
  "geffen_32",
  "beatrice_32",
  "dominic_32",
  "edmund_32",
  "harper_32",
  "hugh_32",
  "imogen_32",
  "wyatt_32",
]);

const corsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
};

const requiredEnv = (name: string) => {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};

const cleanText = (value: unknown, maxLength = MAX_TEXT_LENGTH) =>
  String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);

const cleanVoice = (_value: unknown) => DEFAULT_VOICE;

const cleanRate = (value: unknown) => {
  const rate = typeof value === "number" ? value : Number(value);
  return Number.isFinite(rate) ? Math.min(4, Math.max(0.25, rate)) : 1;
};

const base64ToBytes = (base64: string) =>
  Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));

const audioBytesFrom = (value: unknown) => {
  if (typeof value !== "string" || !value.trim()) return null;

  const audio = value.trim();
  const commaIndex = audio.indexOf(",");
  const base64 = audio.startsWith("data:") && commaIndex >= 0
    ? audio.slice(commaIndex + 1)
    : audio;
  return base64ToBytes(base64.replace(/\s+/g, ""));
};

const audioBase64From = (value: unknown) => {
  if (typeof value !== "string" || !value.trim()) return null;

  const audio = value.trim();
  const commaIndex = audio.indexOf(",");
  return audio.startsWith("data:") && commaIndex >= 0
    ? audio.slice(commaIndex + 1).replace(/\s+/g, "")
    : audio.replace(/\s+/g, "");
};

const cleanWords = (value: unknown) => {
  const chunks = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { chunks?: unknown }).chunks)
      ? (value as { chunks: unknown[] }).chunks
      : [];

  return chunks.flatMap((word) => {
    if (!word || typeof word !== "object") return [];
    const item = word as {
      value?: unknown;
      text?: unknown;
      start?: unknown;
      end?: unknown;
      start_time?: unknown;
      end_time?: unknown;
    };
    const text = String(item.value ?? item.text ?? "").trim();
    // Speechify speech_marks use start_time/end_time in milliseconds.
    const startRaw = item.start_time ?? item.start;
    const endRaw = item.end_time ?? item.end;
    const start = typeof startRaw === "number" ? startRaw : Number(startRaw);
    const end = typeof endRaw === "number" ? endRaw : Number(endRaw);
    const startSeconds = start > 100 ? start / 1000 : start;
    const endSeconds = end > 100 ? end / 1000 : end;
    if (
      !text ||
      !Number.isFinite(startSeconds) ||
      !Number.isFinite(endSeconds) ||
      endSeconds <= startSeconds
    ) {
      return [];
    }
    return [{ text, start: startSeconds, end: endSeconds }];
  });
};

const speechifyErrorMessage = (status: number, result: unknown) => {
  if (result && typeof result === "object") {
    const value = result as {
      error?: unknown;
      message?: unknown;
      detail?: unknown;
    };
    const nested =
      value.error && typeof value.error === "object"
        ? (value.error as { message?: unknown }).message
        : undefined;
    for (const candidate of [value.message, nested, value.error, value.detail]) {
      if (typeof candidate === "string" && candidate.trim()) return candidate;
    }
  }

  if (status === 429) {
    return "Narration generation is busy. Please try again in a moment.";
  }
  return "Speechify narration failed.";
};

const synthesizeSpeech = async (text: string, voice: string, _rate: number) => {
  const apiKey = requiredEnv("SPEECHIFY_API_KEY");
  const response = await fetch(SPEECHIFY_SPEECH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      audio_format: DEFAULT_FORMAT,
      input: text,
      model: DEFAULT_MODEL,
      voice_id: voice,
    }),
  });

  const result = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(speechifyErrorMessage(response.status, result));
  }

  const output = result as {
    audio_data?: unknown;
    audio?: unknown;
    speech_marks?: unknown;
    words?: unknown;
    audio_format?: unknown;
  } | null;
  const audioBase64 = audioBase64From(output?.audio_data ?? output?.audio);
  const audio = audioBase64 ? audioBytesFrom(audioBase64) : null;
  if (!audio?.byteLength) throw new Error("Speechify returned no audio.");

  return {
    audio,
    audioBase64: audioBase64 ?? "",
    outputFormat:
      typeof output?.audio_format === "string" ? output.audio_format : DEFAULT_FORMAT,
    words: cleanWords(output?.speech_marks ?? output?.words),
  };
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 405,
    });
  }

  try {
    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const anonKey = requiredEnv("SUPABASE_ANON_KEY");
    const authorization = req.headers.get("Authorization");
    if (!authorization) throw new Error("Missing Authorization header");

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
    });
    const { data: userData, error: userError } = await userClient.auth
      .getUser();
    if (userError || !userData.user) {
      throw new Error("You must be signed in to use narration.");
    }

    const payload = await req.json();
    const text = cleanText(payload.text);
    const voice = cleanVoice(payload.voice);
    const rate = cleanRate(payload.rate);

    if (!text) throw new Error("No text was provided for speech.");

    const result = await synthesizeSpeech(text, voice, rate);

    return new Response(JSON.stringify({
      audio: result.audioBase64,
      outputFormat: result.outputFormat,
      words: result.words,
    }), {
      headers: {
        ...corsHeaders,
        "Cache-Control": "no-store",
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error
          ? error.message
          : "Could not synthesize speech.",
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      },
    );
  }
});
