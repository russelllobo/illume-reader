import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const BASE_URL = "speech.platform.bing.com/consumer/speech/synthesize/readaloud";
const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const WSS_URL = `wss://${BASE_URL}/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}`;
const CHROMIUM_FULL_VERSION = "143.0.3650.75";
const SEC_MS_GEC_VERSION = `1-${CHROMIUM_FULL_VERSION}`;
const DEFAULT_VOICE = "en-US-AvaMultilingualNeural";
const OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";
const WIN_EPOCH_SECONDS = 11_644_473_600;

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

const connectId = () => crypto.randomUUID().replace(/-/g, "");

const escapeXml = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const dateToString = () =>
  new Date().toUTCString().replace("GMT", "GMT+0000 (Coordinated Universal Time)");

const bytesToHex = (bytes: Uint8Array) =>
  Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();

const generateSecMsGec = async () => {
  let ticks = Date.now() / 1_000;
  ticks += WIN_EPOCH_SECONDS;
  ticks -= ticks % 300;
  ticks *= 10_000_000;

  const payload = new TextEncoder().encode(`${ticks.toFixed(0)}${TRUSTED_CLIENT_TOKEN}`);
  const digest = await crypto.subtle.digest("SHA-256", payload);
  return bytesToHex(new Uint8Array(digest));
};

const speechConfigMessage = () => {
  const config = {
    context: {
      synthesis: {
        audio: {
          metadataoptions: {
            sentenceBoundaryEnabled: "false",
            wordBoundaryEnabled: "false"
          },
          outputFormat: OUTPUT_FORMAT
        }
      }
    }
  };

  return `X-Timestamp:${dateToString()}\r
Content-Type:application/json; charset=utf-8\r
Path:speech.config\r
\r
${JSON.stringify(config)}\r
`;
};

const ssmlMessage = (text: string, voice: string) => {
  const lang = voice.split("-").slice(0, 2).join("-") || "en-US";
  const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${lang}'><voice name='${voice}'><prosody pitch='+0Hz' rate='-5%' volume='+0%'>${escapeXml(text)}</prosody></voice></speak>`;

  return `X-RequestId:${connectId()}\r
Content-Type:application/ssml+xml\r
X-Timestamp:${dateToString()}Z\r
Path:ssml\r
\r
${ssml}`;
};

const parseTextMessage = (message: string) => {
  const [rawHeaders] = message.split("\r\n\r\n", 2);
  const headers: Record<string, string> = {};

  for (const line of rawHeaders.split("\r\n")) {
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    headers[line.slice(0, separator)] = line.slice(separator + 1).trim();
  }

  return headers;
};

const parseBinaryMessage = (message: Uint8Array) => {
  if (message.byteLength < 2) return null;

  const headerLength = new DataView(message.buffer, message.byteOffset, message.byteLength).getUint16(0);
  if (message.byteLength < headerLength + 2) return null;

  const headerText = new TextDecoder().decode(message.slice(2, headerLength + 2));
  const headers: Record<string, string> = {};

  for (const line of headerText.split("\r\n")) {
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    headers[line.slice(0, separator)] = line.slice(separator + 1).trim();
  }

  return {
    data: message.slice(headerLength + 2),
    headers
  };
};

const websocketUrl = async () =>
  `${WSS_URL}&Sec-MS-GEC=${await generateSecMsGec()}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}&ConnectionId=${connectId()}`;

const synthesizeSpeech = (text: string, voice: string) =>
  new ReadableStream<Uint8Array>({
    async start(controller) {
      const ws = new WebSocket(await websocketUrl());
      let audioReceived = false;
      let closed = false;

      const closeStream = () => {
        if (closed) return;
        closed = true;
        controller.close();
      };

      const timeout = setTimeout(() => {
        if (audioReceived || closed) return;
        closed = true;
        try {
          ws.close();
        } catch {
          // noop
        }
        controller.error(new Error("Edge TTS did not return audio quickly enough."));
      }, 10_000);

      ws.binaryType = "arraybuffer";
      ws.onopen = () => {
        ws.send(speechConfigMessage());
        ws.send(ssmlMessage(text, voice));
      };
      ws.onmessage = async (event) => {
        if (typeof event.data === "string") {
          const headers = parseTextMessage(event.data);
          if (headers.Path === "turn.end") {
            clearTimeout(timeout);
            ws.close();
            closeStream();
          }
          return;
        }

        const bytes =
          event.data instanceof ArrayBuffer
            ? new Uint8Array(event.data)
            : event.data instanceof Blob
              ? new Uint8Array(await event.data.arrayBuffer())
              : event.data instanceof Uint8Array
                ? event.data
                : null;

        if (!bytes) return;

        const message = parseBinaryMessage(bytes);
        if (!message || message.headers.Path !== "audio" || message.data.byteLength === 0) return;
        if (message.headers["Content-Type"] !== "audio/mpeg") return;

        audioReceived = true;
        clearTimeout(timeout);
        controller.enqueue(message.data);
      };
      ws.onerror = () => {
        clearTimeout(timeout);
        if (closed) return;
        closed = true;
        controller.error(new Error("Edge TTS WebSocket failed."));
      };
      ws.onclose = () => {
        clearTimeout(timeout);
        if (closed) return;
        if (audioReceived) {
          closeStream();
        } else {
          closed = true;
          controller.error(new Error("Edge TTS closed without audio."));
        }
      };
    },
    cancel() {
      // The websocket closes itself through the event handlers above.
    }
  });

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

    if (!text) throw new Error("No text was provided for speech.");

    return new Response(synthesizeSpeech(text, voice), {
      headers: {
        ...corsHeaders,
        "Cache-Control": "no-store",
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
