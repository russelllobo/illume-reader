import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { spawn } from "node:child_process";

const readRequestBody = async (req: import("node:http").IncomingMessage) =>
  new Promise<string>((resolve, reject) => {
    let body = "";

    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });

const edgeTtsDevProxy = () => ({
  name: "edge-tts-dev-proxy",
  configureServer(server: import("vite").ViteDevServer) {
    server.middlewares.use("/api/edge-tts", async (req, res) => {
      if (req.method !== "POST") {
        res.statusCode = 405;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Method not allowed" }));
        return;
      }

      try {
        const payload = JSON.parse(await readRequestBody(req));
        const text = String(payload.text ?? "").replace(/\s+/g, " ").trim();
        if (!text) throw new Error("No text was provided for speech.");

        const child = spawn(
          process.execPath,
          [
            "--input-type=module",
            "--eval",
            `
              import { Communicate } from "edge-tts-universal";

              const input = await new Promise((resolve, reject) => {
                let body = "";
                process.stdin.setEncoding("utf8");
                process.stdin.on("data", (chunk) => body += chunk);
                process.stdin.on("end", () => resolve(JSON.parse(body)));
                process.stdin.on("error", reject);
              });

              const communicate = new Communicate(String(input.text ?? "").slice(0, 8000), {
                connectionTimeout: 8000,
                pitch: "+0Hz",
                rate: "-5%",
                voice: String(input.voice ?? "en-US-AvaNeural"),
                volume: "+0%"
              });

              for await (const chunk of communicate.stream()) {
                if (chunk.type === "audio" && chunk.data) {
                  process.stdout.write(chunk.data);
                }
              }
            `
          ],
          {
            cwd: process.cwd(),
            stdio: ["pipe", "pipe", "pipe"]
          }
        );

        res.statusCode = 200;
        res.setHeader("Content-Type", "audio/mpeg");
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Transfer-Encoding", "chunked");

        child.stdin.end(JSON.stringify({ text, voice: String(payload.voice ?? "en-US-AvaNeural") }));
        child.stdout.pipe(res, { end: false });

        let stderr = "";
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (chunk) => {
          stderr += chunk;
        });

        req.on("close", () => child.kill());
        child.on("error", (error) => {
          if (!res.destroyed) res.destroy(error);
        });
        child.on("close", (code) => {
          if (res.destroyed) return;
          if (code === 0) {
            res.end();
            return;
          }
          res.destroy(new Error(stderr.trim() || "Speech failed."));
        });
      } catch (error) {
        if (res.headersSent) {
          res.destroy(error instanceof Error ? error : undefined);
          return;
        }

        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : "Speech failed." }));
      }
    });
  }
});

export default defineConfig({
  plugins: [edgeTtsDevProxy(), react()],
  server: {
    port: 5173
  }
});
