import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { Communicate } from "npm:edge-tts-universal@^1.4.0";

const DEFAULT_VOICE = "en-US-AvaMultilingualNeural";

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*"
};

const cleanText = (value: unknown, maxLength = 8_000) =>
  String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);

const cleanVoice = (value: unknown) => {
  const voice = String(value ?? DEFAULT_VOICE).trim();
  return /^[a-z]{2,}-[A-Z]{2,}-.+Neural$/.test(voice) ? voice : DEFAULT_VOICE;
};

const cleanRate = (value: unknown) => {
  const multiplier = typeof value === "number" ? value : Number(value);
  const safeMultiplier = Number.isFinite(multiplier) ? Math.min(2, Math.max(0.7, multiplier)) : 1;
  const percent = Math.round((safeMultiplier - 1) * 100);
  return `${percent >= 0 ? "+" : ""}${percent}%`;
};

const bytesFrom = (value: unknown) => {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return null;
};

const concatChunks = (chunks: Uint8Array[], byteLength: number) => {
  const output = new Uint8Array(byteLength);
  let offset = 0;

  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return output;
};

const synthesizeSpeech = async (text: string, voice: string, rate: string) => {
  const communicate = new Communicate(text, {
    connectionTimeout: 8_000,
    pitch: "+0Hz",
    rate,
    voice,
    volume: "+0%"
  });
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  for await (const chunk of communicate.stream()) {
    if (chunk.type !== "audio") continue;
    const bytes = bytesFrom(chunk.data);
    if (!bytes?.byteLength) continue;

    chunks.push(bytes);
    byteLength += bytes.byteLength;
  }

  if (!byteLength) {
    throw new Error("Edge TTS returned no audio.");
  }

  return concatChunks(chunks, byteLength);
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 405
    });
  }

  try {
    const payload = await req.json();
    const text = cleanText(payload.text);
    const voice = cleanVoice(payload.voice);
    const rate = cleanRate(payload.rate);

    if (!text) throw new Error("No text was provided for speech.");

    const audio = await synthesizeSpeech(text, voice, rate);

    return new Response(audio, {
      headers: {
        ...corsHeaders,
        "Cache-Control": "no-store",
        "Content-Length": String(audio.byteLength),
        "Content-Type": "audio/mpeg"
      }
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Could not synthesize speech." }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400
      }
    );
  }
});
