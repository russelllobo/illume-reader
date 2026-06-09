import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.106.0";

const DEEPINFRA_KOKORO_URL =
  "https://api.deepinfra.com/v1/inference/hexgrad/Kokoro-82M";
const DEFAULT_VOICE = "af_heart";
const DEFAULT_FORMAT = "wav";
const MAX_TEXT_LENGTH = 8_000;

const allowedVoices = new Set([
  "af_alloy",
  "af_aoede",
  "af_bella",
  "af_heart",
  "af_jessica",
  "af_kore",
  "af_nicole",
  "af_nova",
  "af_river",
  "af_sarah",
  "af_sky",
  "am_adam",
  "am_echo",
  "am_eric",
  "am_fenrir",
  "am_liam",
  "am_michael",
  "am_onyx",
  "am_puck",
  "am_santa",
  "bf_alice",
  "bf_emma",
  "bf_isabella",
  "bf_lily",
  "bm_daniel",
  "bm_fable",
  "bm_george",
  "bm_lewis",
  "ef_dora",
  "em_alex",
  "em_santa",
  "ff_siwis",
  "hf_alpha",
  "hf_beta",
  "hm_omega",
  "hm_psi",
  "if_sara",
  "im_nicola",
  "jf_alpha",
  "jf_gongitsune",
  "jf_nezumi",
  "jf_tebukuro",
  "jm_kumo",
  "pf_dora",
  "pm_alex",
  "pm_santa",
  "zf_xiaobei",
  "zf_xiaoni",
  "zf_xiaoxiao",
  "zf_xiaoyi",
  "zm_yunjian",
  "zm_yunxi",
  "zm_yunxia",
  "zm_yunyang",
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

const cleanVoice = (value: unknown) => {
  const voice = String(value ?? DEFAULT_VOICE).trim();
  return allowedVoices.has(voice) ? voice : DEFAULT_VOICE;
};

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
  if (!Array.isArray(value)) return [];

  return value.flatMap((word) => {
    if (!word || typeof word !== "object") return [];
    const item = word as { text?: unknown; start?: unknown; end?: unknown };
    const text = String(item.text ?? "").trim();
    const start = typeof item.start === "number" ? item.start : Number(item.start);
    const end = typeof item.end === "number" ? item.end : Number(item.end);
    if (!text || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return [];
    }
    return [{ text, start, end }];
  });
};

const deepInfraErrorMessage = (status: number, result: unknown) => {
  if (result && typeof result === "object") {
    const value = result as {
      error?: unknown;
      message?: unknown;
      detail?: unknown;
    };
    for (const candidate of [value.message, value.error, value.detail]) {
      if (typeof candidate === "string" && candidate.trim()) return candidate;
    }
  }

  if (status === 429) {
    return "Narration generation is busy. Please try again in a moment.";
  }
  return "DeepInfra Kokoro TTS failed.";
};

const synthesizeSpeech = async (text: string, voice: string, rate: number) => {
  const apiKey = requiredEnv("DEEPINFRA_API_KEY");
  const response = await fetch(DEEPINFRA_KOKORO_URL, {
    method: "POST",
    headers: {
      Authorization: `bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      output_format: DEFAULT_FORMAT,
      preset_voice: [voice],
      return_timestamps: true,
      speed: rate,
      stream: false,
      text,
    }),
  });

  const result = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(deepInfraErrorMessage(response.status, result));
  }

  const output = result as { audio?: unknown; words?: unknown; output_format?: unknown } | null;
  const audioBase64 = audioBase64From(output?.audio);
  const audio = audioBase64 ? audioBytesFrom(audioBase64) : null;
  if (!audio?.byteLength) throw new Error("Kokoro TTS returned no audio.");

  return {
    audio,
    audioBase64: audioBase64 ?? "",
    outputFormat: typeof output?.output_format === "string" ? output.output_format : DEFAULT_FORMAT,
    words: cleanWords(output?.words),
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
