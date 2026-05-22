import type { IncomingMessage, ServerResponse } from "node:http";
import { Communicate } from "edge-tts-universal";

const DEFAULT_VOICE = "en-GB-SoniaNeural";

export const config = {
  maxDuration: 30
};

const readBody = (req: IncomingMessage) =>
  new Promise<string>((resolve, reject) => {
    let body = "";

    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });

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

const sendJson = (res: ServerResponse, statusCode: number, body: unknown) => {
  res.statusCode = statusCode;
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
};

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.end();
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  try {
    const payload = JSON.parse(await readBody(req));
    const text = cleanText(payload.text);
    const voice = cleanVoice(payload.voice);

    if (!text) {
      sendJson(res, 400, { error: "No text was provided for speech." });
      return;
    }

    const communicate = new Communicate(text, {
      connectionTimeout: 8_000,
      pitch: "+0Hz",
      rate: "-5%",
      voice,
      volume: "+0%"
    });

    res.statusCode = 200;
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "audio/mpeg");

    for await (const chunk of communicate.stream()) {
      if (res.destroyed) return;
      if (chunk.type === "audio" && chunk.data) {
        res.write(chunk.data);
      }
    }

    res.end();
  } catch (error) {
    if (res.headersSent) {
      res.destroy(error instanceof Error ? error : undefined);
      return;
    }

    sendJson(res, 400, { error: error instanceof Error ? error.message : "Could not synthesize speech." });
  }
}
