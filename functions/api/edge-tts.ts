// Cloudflare Pages Function. Uses a raw TLS socket because the Edge TTS
// endpoint expects browser-like WebSocket headers that are not available from
// standard Pages/Workers WebSocket constructors.
// @ts-nocheck
import { connect } from "cloudflare:sockets";

const HOST = "speech.platform.bing.com";
const PATH = "/consumer/speech/synthesize/readaloud/edge/v1";
const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const CHROMIUM_FULL_VERSION = "143.0.3650.75";
const CHROMIUM_MAJOR_VERSION = CHROMIUM_FULL_VERSION.split(".")[0];
const SEC_MS_GEC_VERSION = `1-${CHROMIUM_FULL_VERSION}`;
const DEFAULT_VOICE = "en-US-AvaNeural";
const OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";
const WIN_EPOCH_SECONDS = 11_644_473_600;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, content-type",
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

const bytesToHex = (bytes: Uint8Array) =>
  Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();

const randomBytes = (length: number) => {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
};

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const connectId = () => crypto.randomUUID().replace(/-/g, "");

const dateToString = () =>
  new Date().toUTCString().replace("GMT", "GMT+0000 (Coordinated Universal Time)");

const escapeXml = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const generateSecMsGec = async () => {
  let ticks = Date.now() / 1_000;
  ticks += WIN_EPOCH_SECONDS;
  ticks -= ticks % 300;
  ticks *= 10_000_000;

  const payload = encoder.encode(`${ticks.toFixed(0)}${TRUSTED_CLIENT_TOKEN}`);
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

const parseHeaders = (headerText: string) => {
  const headers: Record<string, string> = {};

  for (const line of headerText.split("\r\n")) {
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    headers[line.slice(0, separator)] = line.slice(separator + 1).trim();
  }

  return headers;
};

const parseEdgeTextHeaders = (message: string) => parseHeaders(message.split("\r\n\r\n", 2)[0]);

const parseEdgeBinary = (bytes: Uint8Array) => {
  if (bytes.byteLength < 2) return null;
  const headerLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(0);
  if (bytes.byteLength < headerLength + 2) return null;

  return {
    data: bytes.slice(headerLength + 2),
    headers: parseHeaders(decoder.decode(bytes.slice(2, headerLength + 2)))
  };
};

const concatBytes = (first: Uint8Array, second: Uint8Array) => {
  if (!first.byteLength) return second;
  if (!second.byteLength) return first;
  const result = new Uint8Array(first.byteLength + second.byteLength);
  result.set(first);
  result.set(second, first.byteLength);
  return result;
};

const maskPayload = (payload: Uint8Array, mask: Uint8Array) => {
  const masked = new Uint8Array(payload.byteLength);
  for (let index = 0; index < payload.byteLength; index += 1) {
    masked[index] = payload[index] ^ mask[index % 4];
  }
  return masked;
};

const websocketFrame = (opcode: number, payloadInput: string | Uint8Array) => {
  const payload = typeof payloadInput === "string" ? encoder.encode(payloadInput) : payloadInput;
  const mask = randomBytes(4);
  const length = payload.byteLength;
  let headerLength = 2;

  if (length >= 126 && length <= 65_535) headerLength += 2;
  if (length > 65_535) headerLength += 8;

  const frame = new Uint8Array(headerLength + 4 + length);
  frame[0] = 0x80 | opcode;

  if (length < 126) {
    frame[1] = 0x80 | length;
  } else if (length <= 65_535) {
    frame[1] = 0x80 | 126;
    new DataView(frame.buffer).setUint16(2, length);
  } else {
    frame[1] = 0x80 | 127;
    new DataView(frame.buffer).setBigUint64(2, BigInt(length));
  }

  frame.set(mask, headerLength);
  frame.set(maskPayload(payload, mask), headerLength + 4);
  return frame;
};

const parseWebSocketFrame = (buffer: Uint8Array) => {
  if (buffer.byteLength < 2) return null;

  const first = buffer[0];
  const second = buffer[1];
  const opcode = first & 0x0f;
  const masked = (second & 0x80) !== 0;
  let length = second & 0x7f;
  let offset = 2;

  if (length === 126) {
    if (buffer.byteLength < offset + 2) return null;
    length = new DataView(buffer.buffer, buffer.byteOffset + offset, 2).getUint16(0);
    offset += 2;
  } else if (length === 127) {
    if (buffer.byteLength < offset + 8) return null;
    const bigLength = new DataView(buffer.buffer, buffer.byteOffset + offset, 8).getBigUint64(0);
    if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("WebSocket frame is too large.");
    length = Number(bigLength);
    offset += 8;
  }

  let mask = new Uint8Array(0);
  if (masked) {
    if (buffer.byteLength < offset + 4) return null;
    mask = buffer.slice(offset, offset + 4);
    offset += 4;
  }

  if (buffer.byteLength < offset + length) return null;

  const rawPayload = buffer.slice(offset, offset + length);
  const payload = masked ? maskPayload(rawPayload, mask) : rawPayload;
  return {
    consumed: offset + length,
    opcode,
    payload
  };
};

const openEdgeSocket = async () => {
  const socket = connect({ hostname: HOST, port: 443 }, { secureTransport: "on" });
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  const secMsGec = await generateSecMsGec();
  const path = `${PATH}?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}&Sec-MS-GEC=${secMsGec}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}&ConnectionId=${connectId()}`;
  const request = [
    `GET ${path} HTTP/1.1`,
    `Host: ${HOST}`,
    "Connection: Upgrade",
    "Upgrade: websocket",
    `Sec-WebSocket-Key: ${bytesToBase64(randomBytes(16))}`,
    "Sec-WebSocket-Version: 13",
    "Pragma: no-cache",
    "Cache-Control: no-cache",
    "Origin: chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
    `Cookie: muid=${bytesToHex(randomBytes(16))};`,
    `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_MAJOR_VERSION}.0.0.0 Safari/537.36 Edg/${CHROMIUM_MAJOR_VERSION}.0.0.0`,
    "Accept-Language: en-US,en;q=0.9",
    "",
    ""
  ].join("\r\n");

  await writer.write(encoder.encode(request));

  let buffer = new Uint8Array(0);
  let headerEnd = -1;
  while (headerEnd < 0) {
    const { done, value } = await reader.read();
    if (done || !value) throw new Error("Edge TTS closed during WebSocket handshake.");
    buffer = concatBytes(buffer, value);
    const headerText = decoder.decode(buffer);
    headerEnd = headerText.indexOf("\r\n\r\n");
  }

  const headerText = decoder.decode(buffer.slice(0, headerEnd));
  if (!headerText.startsWith("HTTP/1.1 101")) {
    throw new Error(`Edge TTS handshake failed: ${headerText.split("\r\n")[0]}`);
  }

  return {
    buffered: buffer.slice(headerEnd + 4),
    reader,
    socket,
    writer
  };
};

const synthesizeSpeech = (text: string, voice: string) =>
  new ReadableStream<Uint8Array>({
    async start(controller) {
      const edge = await openEdgeSocket();
      let buffer = edge.buffered;
      let audioReceived = false;
      let closed = false;

      const close = async () => {
        if (closed) return;
        closed = true;
        try {
          await edge.writer.write(websocketFrame(0x8, new Uint8Array(0)));
        } catch {
          // noop
        }
        try {
          await edge.socket.close();
        } catch {
          // noop
        }
      };

      const timeout = setTimeout(() => {
        if (audioReceived || closed) return;
        void close();
        controller.error(new Error("Edge TTS did not return audio quickly enough."));
      }, 10_000);

      await edge.writer.write(websocketFrame(0x1, speechConfigMessage()));
      await edge.writer.write(websocketFrame(0x1, ssmlMessage(text, voice)));

      while (!closed) {
        let frame = parseWebSocketFrame(buffer);
        while (frame) {
          buffer = buffer.slice(frame.consumed);

          if (frame.opcode === 0x1) {
            const headers = parseEdgeTextHeaders(decoder.decode(frame.payload));
            if (headers.Path === "turn.end") {
              clearTimeout(timeout);
              await close();
              controller.close();
              return;
            }
          } else if (frame.opcode === 0x2) {
            const message = parseEdgeBinary(frame.payload);
            if (message?.headers.Path === "audio" && message.headers["Content-Type"] === "audio/mpeg" && message.data.byteLength) {
              audioReceived = true;
              clearTimeout(timeout);
              controller.enqueue(message.data);
            }
          } else if (frame.opcode === 0x8) {
            await close();
            if (audioReceived) {
              controller.close();
            } else {
              controller.error(new Error("Edge TTS closed without audio."));
            }
            return;
          } else if (frame.opcode === 0x9) {
            await edge.writer.write(websocketFrame(0xA, frame.payload));
          }

          frame = parseWebSocketFrame(buffer);
        }

        const { done, value } = await edge.reader.read();
        if (done || !value) {
          await close();
          if (audioReceived) {
            controller.close();
          } else {
            controller.error(new Error("Edge TTS closed without audio."));
          }
          return;
        }
        buffer = concatBytes(buffer, value);
      }
    }
  });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status
  });

export const onRequestOptions: PagesFunction = async () =>
  new Response("ok", { headers: corsHeaders });

export const onRequestPost: PagesFunction = async ({ request }) => {
  try {
    const payload = await request.json();
    const text = cleanText(payload.text);
    const voice = cleanVoice(payload.voice);

    if (!text) return json({ error: "No text was provided for speech." }, 400);

    return new Response(synthesizeSpeech(text, voice), {
      headers: {
        ...corsHeaders,
        "Cache-Control": "no-store",
        "Content-Type": "audio/mpeg"
      }
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Could not synthesize speech." }, 400);
  }
};

export const onRequest: PagesFunction = async () => json({ error: "Method not allowed" }, 405);
