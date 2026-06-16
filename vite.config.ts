import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

const jsonResponse = (res: import("node:http").ServerResponse, statusCode: number, payload: unknown) => {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
};

const projectRoot = fileURLToPath(new URL(".", import.meta.url));
const artifactsRoot = resolve(projectRoot, "artifacts");
const defaultReelSourceDir = "/home/russ/reading a classic";
const defaultSupabaseUrl = "https://mduemjbplprditrqolcp.supabase.co";
const reelAudioExtensions = new Set([".aac", ".aiff", ".flac", ".m4a", ".mp3", ".mp4", ".mov", ".wav", ".webm"]);
const instagramContainerPollIntervalsMs = [3_000, 5_000, 8_000, 12_000, 15_000, 15_000, 15_000];

const safeArtifactPath = (value: string) => {
  const target = resolve(value);
  if (!target.startsWith(artifactsRoot)) throw new Error("Only generated artifact files can be served.");
  return target;
};

const safeReelAudioPath = (value: string) => {
  const target = resolve(value);
  if (!reelAudioExtensions.has(extname(target).toLowerCase())) throw new Error("Unsupported audio file.");
  return target;
};

const publicMediaUrl = (path: string) => `/api/reels/media?path=${encodeURIComponent(path)}`;

const reelMusicDir = (sourceDir: string) => resolve(sourceDir, "music");
const reelTimingPresetsPath = (sourceDir: string) => resolve(reelMusicDir(sourceDir), "timing-presets.json");
const reelAudioPreviewPath = (audioPath: string) => {
  const hash = createHash("sha1").update(resolve(audioPath)).digest("hex");
  return resolve(artifactsRoot, "audio-previews", `${hash}.m4a`);
};

const normalizeReelTimingPresets = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Timing presets must be a JSON object.");
  }
  const payload = value as { tracks?: unknown; version?: unknown };
  if (!payload.tracks || typeof payload.tracks !== "object" || Array.isArray(payload.tracks)) {
    return { version: 1, tracks: {} };
  }
  return {
    version: Number(payload.version) || 1,
    tracks: payload.tracks as Record<string, unknown>
  };
};

const readReelTimingPresets = async (sourceDir: string) => {
  try {
    return normalizeReelTimingPresets(JSON.parse(await readFile(reelTimingPresetsPath(sourceDir), "utf8")));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return { version: 1, tracks: {} };
    }
    throw error;
  }
};

const writeReelTimingPresets = async (sourceDir: string, presets: unknown) => {
  const normalized = normalizeReelTimingPresets(presets);
  await mkdir(reelMusicDir(sourceDir), { recursive: true });
  await writeFile(reelTimingPresetsPath(sourceDir), `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
};

const listReelMusic = async (sourceDir: string) => {
  const musicDir = reelMusicDir(sourceDir);
  const entries = await readdir(musicDir, { withFileTypes: true });
  const tracks = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && reelAudioExtensions.has(extname(entry.name).toLowerCase()))
      .map(async (entry) => {
        const path = resolve(musicDir, entry.name);
        const fileStat = await stat(path);
        return { name: entry.name, path, sizeBytes: fileStat.size };
      })
  );
  return { presetPath: reelTimingPresetsPath(sourceDir), presets: await readReelTimingPresets(sourceDir), tracks };
};

const ensureReelAudioPreview = async (audioPath: string) => {
  const target = safeReelAudioPath(audioPath);
  const previewPath = reelAudioPreviewPath(target);
  try {
    const [previewStat, sourceStat] = await Promise.all([stat(previewPath), stat(target)]);
    if (previewStat.mtimeMs >= sourceStat.mtimeMs) return previewPath;
  } catch {
    // Missing or stale previews are regenerated below.
  }

  await mkdir(resolve(artifactsRoot, "audio-previews"), { recursive: true });
  await spawnProcess("ffmpeg", [
    "-y",
    "-i",
    target,
    "-vn",
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-movflags",
    "+faststart",
    previewPath
  ]);
  return previewPath;
};

const serviceRoleHeaders = () => {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) return null;
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json"
  };
};

const loadOwnerConnection = async <T,>(table: string, select: string): Promise<T | null> => {
  const headers = serviceRoleHeaders();
  if (!headers) return null;
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || defaultSupabaseUrl;
  const response = await fetch(`${supabaseUrl}/rest/v1/${table}?select=${select}&id=eq.owner&limit=1`, { headers });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message || `Could not load ${table}.`);
  return (body[0] as T | undefined) ?? null;
};

const refreshGoogleAccessToken = async (refreshToken: string) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return "";

  const response = await fetch("https://oauth2.googleapis.com/token", {
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken
    }),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    method: "POST"
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error_description || body.error || "Could not refresh YouTube token.");
  return String(body.access_token || "");
};

const spawnProcess = (cmd: string, args: string[], cwd = projectRoot) =>
  new Promise<{ stderr: string; stdout: string }>((resolveProcess, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolveProcess({ stderr, stdout });
        return;
      }
      reject(new Error(stderr.trim() || stdout.trim() || `${cmd} exited with ${code}`));
    });
  });

const readReelMetadata = async (outputDir: string) => {
  const metadataPath = resolve(outputDir, "run-metadata.json");
  const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
  const videoPath = resolve(outputDir, "reading-classic-instagram-reel.mp4");
  const youtubePath = resolve(outputDir, "reading-classic-youtube-short.mp4");
  const slidePaths = Array.isArray(metadata.slides) ? metadata.slides.map((slide: string) => resolve(slide)) : [];
  const videoStat = await stat(videoPath);

  return {
    id: outputDir.split("/").pop(),
    outputDir,
    videoPath,
    youtubePath,
    previewUrl: publicMediaUrl(videoPath),
    youtubePreviewUrl: publicMediaUrl(youtubePath),
    slidePaths,
    slidePreviewUrls: slidePaths.map(publicMediaUrl),
    metadata,
    sizeBytes: videoStat.size
  };
};

const generateReels = async (payload: Record<string, unknown>) => {
  const sourceDir = String(payload.sourceDir || defaultReelSourceDir);
  const count = Math.max(1, Math.min(6, Number(payload.count ?? 3) || 3));
  const seedBase = Number(payload.seedBase ?? Date.now());
  const audioFile = typeof payload.audioFile === "string" ? payload.audioFile : "";
  const timingPreset =
    payload.timingPreset && typeof payload.timingPreset === "object" && !Array.isArray(payload.timingPreset)
      ? payload.timingPreset
      : null;
  const snapToBeats = payload.snapToBeats !== false;
  const runId = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const reels = [];

  for (let index = 0; index < count; index += 1) {
    const outputDir = resolve(artifactsRoot, `dashboard-reel-${runId}-${String(index + 1).padStart(2, "0")}`);
    const args = [
      "scripts/classic_slideshow.py",
      "--source-dir",
      sourceDir,
      "--output-dir",
      outputDir,
      "--seed",
      String(seedBase + index)
    ];
    if (audioFile) args.push("--audio-file", audioFile);
    if (timingPreset) {
      await mkdir(outputDir, { recursive: true });
      const presetPath = resolve(outputDir, "timing-preset.json");
      await writeFile(presetPath, `${JSON.stringify(timingPreset, null, 2)}\n`, "utf8");
      args.push("--timing-preset-file", presetPath);
      if (snapToBeats) args.push("--snap-to-beats");
    }
    await spawnProcess("python3", args);
    reels.push(await readReelMetadata(outputDir));
  }

  return { reels };
};

const uploadYouTubeShort = async (videoPath: string, payload: Record<string, unknown>) => {
  let accessToken = String(payload.youtubeAccessToken || process.env.YOUTUBE_UPLOAD_ACCESS_TOKEN || "");
  if (!accessToken) {
    const connection = await loadOwnerConnection<{ refresh_token: string }>("youtube_dashboard_connection", "refresh_token");
    if (connection?.refresh_token) accessToken = await refreshGoogleAccessToken(connection.refresh_token);
  }
  if (!accessToken) {
    throw new Error("Missing YouTube upload token. Set YOUTUBE_UPLOAD_ACCESS_TOKEN, or set SUPABASE_SERVICE_ROLE_KEY plus GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET and link YouTube with upload scope.");
  }

  const video = await readFile(videoPath);
  const body = {
    snippet: {
      categoryId: "22",
      description: String(payload.description || "Trying to read a classic without dissociating #reading #classics #booktok"),
      title: String(payload.title || "Trying to read a classic without dissociating")
    },
    status: {
      privacyStatus: String(payload.privacyStatus || "private"),
      selfDeclaredMadeForKids: false
    }
  };

  const initResponse = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    body: JSON.stringify(body),
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Length": String(video.byteLength),
      "X-Upload-Content-Type": "video/mp4"
    },
    method: "POST"
  });
  if (!initResponse.ok) throw new Error(`YouTube upload init failed: ${await initResponse.text()}`);

  const uploadUrl = initResponse.headers.get("location");
  if (!uploadUrl) throw new Error("YouTube did not return a resumable upload URL.");

  const uploadResponse = await fetch(uploadUrl, {
    body: video,
    headers: {
      "Content-Length": String(video.byteLength),
      "Content-Type": "video/mp4"
    },
    method: "PUT"
  });
  const result = await uploadResponse.json().catch(() => ({}));
  if (!uploadResponse.ok) throw new Error(`YouTube upload failed: ${JSON.stringify(result)}`);

  return { platform: "youtube", result, url: result.id ? `https://www.youtube.com/watch?v=${result.id}` : undefined };
};

const instagramContainerStatus = async (graphVersion: string, containerId: string, accessToken: string) => {
  const statusUrl = new URL(`https://graph.facebook.com/${graphVersion}/${containerId}`);
  statusUrl.searchParams.set("fields", "id,status,status_code");
  statusUrl.searchParams.set("access_token", accessToken);

  const response = await fetch(statusUrl);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Instagram container status failed: ${JSON.stringify(body)}`);
  return body;
};

const waitForInstagramContainer = async (graphVersion: string, containerId: string, accessToken: string) => {
  let lastStatus: Record<string, unknown> | null = null;

  for (const intervalMs of instagramContainerPollIntervalsMs) {
    await new Promise((resolvePoll) => setTimeout(resolvePoll, intervalMs));
    const currentStatus = await instagramContainerStatus(graphVersion, containerId, accessToken);
    lastStatus = currentStatus;
    const statusCode = String(currentStatus.status_code || "");

    if (statusCode === "FINISHED") return currentStatus;
    if (statusCode === "ERROR" || statusCode === "EXPIRED") {
      throw new Error(`Instagram container processing failed: ${JSON.stringify(currentStatus)}`);
    }
  }

  throw new Error(`Instagram container processing timed out: ${JSON.stringify(lastStatus)}`);
};

const postInstagramReel = async (videoPath: string, payload: Record<string, unknown>) => {
  let accessToken = String(payload.instagramAccessToken || process.env.INSTAGRAM_ACCESS_TOKEN || "");
  let instagramUserId = String(payload.instagramUserId || process.env.INSTAGRAM_USER_ID || "");
  if (!accessToken || !instagramUserId) {
    const connection = await loadOwnerConnection<{ access_token: string; instagram_user_id?: string | null }>(
      "instagram_dashboard_connection",
      "access_token,instagram_user_id"
    );
    accessToken ||= connection?.access_token ?? "";
    instagramUserId ||= connection?.instagram_user_id ?? "";
  }
  const publicVideoUrl = String(payload.publicVideoUrl || process.env.REEL_PUBLIC_VIDEO_URL || "");
  const graphVersion = String(process.env.INSTAGRAM_GRAPH_VERSION || "v25.0");
  if (!accessToken) throw new Error("Missing Instagram access token. Set INSTAGRAM_ACCESS_TOKEN, or set SUPABASE_SERVICE_ROLE_KEY and link Instagram with publishing scope.");
  if (!instagramUserId) throw new Error("Missing Instagram user id. Set INSTAGRAM_USER_ID, or link an Instagram professional account in the dashboard.");
  if (!publicVideoUrl) {
    throw new Error(`Instagram publishing needs a public HTTPS video URL. Host ${videoPath} and pass publicVideoUrl or set REEL_PUBLIC_VIDEO_URL.`);
  }

  const caption = String(payload.description || "Trying to read a classic without dissociating #reading #classics #bored #art");
  const createParams = new URLSearchParams({
    access_token: accessToken,
    caption,
    media_type: "REELS",
    share_to_feed: "true",
    video_url: publicVideoUrl
  });
  const createResponse = await fetch(`https://graph.facebook.com/${graphVersion}/${instagramUserId}/media`, {
    body: createParams,
    method: "POST"
  });
  const createResult = await createResponse.json();
  if (!createResponse.ok) throw new Error(`Instagram container creation failed: ${JSON.stringify(createResult)}`);

  const containerStatus = await waitForInstagramContainer(graphVersion, String(createResult.id), accessToken);

  const publishParams = new URLSearchParams({
    access_token: accessToken,
    creation_id: String(createResult.id)
  });
  const publishResponse = await fetch(`https://graph.facebook.com/${graphVersion}/${instagramUserId}/media_publish`, {
    body: publishParams,
    method: "POST"
  });
  const publishResult = await publishResponse.json();
  if (!publishResponse.ok) throw new Error(`Instagram publish failed: ${JSON.stringify(publishResult)}`);

  return { container: createResult, containerStatus, platform: "instagram", result: publishResult };
};

const uploadTikTokVideo = async (videoPath: string, payload: Record<string, unknown>) => {
  let accessToken = String(payload.tiktokAccessToken || process.env.TIKTOK_ACCESS_TOKEN || "");
  if (!accessToken) {
    const connection = await loadOwnerConnection<{ access_token: string }>("tiktok_dashboard_connection", "access_token");
    accessToken = connection?.access_token ?? "";
  }
  if (!accessToken) throw new Error("Missing TikTok access token. Set TIKTOK_ACCESS_TOKEN, or set SUPABASE_SERVICE_ROLE_KEY and link TikTok with upload scope.");

  const mode = String(payload.tiktokMode || "draft");
  if (mode !== "draft") {
    throw new Error("TikTok direct post needs app approval for Direct Post plus the video.publish scope; this local endpoint currently supports TikTok draft upload.");
  }

  const { stdout } = await spawnProcess("python3", [
    "-c",
    `
import json, os, sys
from pathlib import Path
sys.path.insert(0, "scripts")
from classic_slideshow import upload_tiktok_video_draft
result = upload_tiktok_video_draft(Path(sys.argv[1]), sys.argv[2])
print(json.dumps(result))
`,
    videoPath,
    accessToken
  ], projectRoot);

  return { platform: "tiktok", result: JSON.parse(stdout.trim().split("\\n").pop() || "{}") };
};

const postReel = async (payload: Record<string, unknown>) => {
  const videoPath = safeArtifactPath(String(payload.videoPath || ""));
  const platforms = Array.isArray(payload.platforms) ? payload.platforms.map(String) : ["youtube", "instagram", "tiktok"];
  const results = [];

  for (const platform of platforms) {
    try {
      if (platform === "youtube") results.push(await uploadYouTubeShort(videoPath, payload));
      else if (platform === "instagram") results.push(await postInstagramReel(videoPath, payload));
      else if (platform === "tiktok") results.push(await uploadTikTokVideo(videoPath, payload));
    } catch (error) {
      results.push({ error: error instanceof Error ? error.message : String(error), platform });
    }
  }

  return { results };
};

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
                voice: String(input.voice ?? "en-US-AvaMultilingualNeural"),
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

        child.stdin.end(JSON.stringify({ text, voice: String(payload.voice ?? "en-US-AvaMultilingualNeural") }));
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

const reelsDevApi = () => ({
  name: "reels-dev-api",
  configureServer(server: import("vite").ViteDevServer) {
    server.middlewares.use("/api/reels/music", async (req, res) => {
      if (req.method !== "GET") {
        jsonResponse(res, 405, { error: "Method not allowed" });
        return;
      }

      try {
        const url = new URL(req.url || "", "http://localhost");
        const sourceDir = url.searchParams.get("sourceDir") || defaultReelSourceDir;
        jsonResponse(res, 200, await listReelMusic(sourceDir));
      } catch (error) {
        jsonResponse(res, 400, { error: error instanceof Error ? error.message : "Could not load reel music." });
      }
    });

    server.middlewares.use("/api/reels/music-presets", async (req, res) => {
      if (req.method !== "POST") {
        jsonResponse(res, 405, { error: "Method not allowed" });
        return;
      }

      try {
        const payload = JSON.parse(await readRequestBody(req) || "{}");
        const sourceDir = String(payload.sourceDir || defaultReelSourceDir);
        jsonResponse(res, 200, { presets: await writeReelTimingPresets(sourceDir, payload.presets) });
      } catch (error) {
        jsonResponse(res, 400, { error: error instanceof Error ? error.message : "Could not save timing presets." });
      }
    });

    server.middlewares.use("/api/reels/generate", async (req, res) => {
      if (req.method !== "POST") {
        jsonResponse(res, 405, { error: "Method not allowed" });
        return;
      }

      try {
        const payload = JSON.parse(await readRequestBody(req) || "{}");
        jsonResponse(res, 200, await generateReels(payload));
      } catch (error) {
        jsonResponse(res, 400, { error: error instanceof Error ? error.message : "Reel generation failed." });
      }
    });

    server.middlewares.use("/api/reels/post", async (req, res) => {
      if (req.method !== "POST") {
        jsonResponse(res, 405, { error: "Method not allowed" });
        return;
      }

      try {
        const payload = JSON.parse(await readRequestBody(req) || "{}");
        jsonResponse(res, 200, await postReel(payload));
      } catch (error) {
        jsonResponse(res, 400, { error: error instanceof Error ? error.message : "Posting failed." });
      }
    });

    server.middlewares.use("/api/reels/audio", async (req, res) => {
      try {
        const url = new URL(req.url || "", "http://localhost");
        const target = await ensureReelAudioPreview(url.searchParams.get("path") || "");
        const contentType = "audio/mp4";
        const fileStat = await stat(target);
        const range = req.headers.range;
        res.setHeader("Content-Type", contentType);
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Accept-Ranges", "bytes");

        if (range) {
          const match = range.match(/bytes=(\d*)-(\d*)/);
          const start = match?.[1] ? Number(match[1]) : 0;
          const end = match?.[2] ? Number(match[2]) : fileStat.size - 1;
          if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= fileStat.size) {
            res.statusCode = 416;
            res.setHeader("Content-Range", `bytes */${fileStat.size}`);
            res.end();
            return;
          }
          res.statusCode = 206;
          res.setHeader("Content-Range", `bytes ${start}-${end}/${fileStat.size}`);
          res.setHeader("Content-Length", String(end - start + 1));
          createReadStream(target, { end, start }).pipe(res);
          return;
        }

        res.statusCode = 200;
        res.setHeader("Content-Length", String(fileStat.size));
        createReadStream(target).pipe(res);
      } catch (error) {
        jsonResponse(res, 404, { error: error instanceof Error ? error.message : "Audio not found." });
      }
    });

    server.middlewares.use("/api/reels/media", async (req, res) => {
      try {
        const url = new URL(req.url || "", "http://localhost");
        const target = safeArtifactPath(url.searchParams.get("path") || "");
        const extension = extname(target).toLowerCase();
        const contentType = extension === ".mp4" ? "video/mp4" : "image/jpeg";
        const fileStat = await stat(target);
        const range = req.headers.range;
        res.setHeader("Content-Type", contentType);
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Accept-Ranges", "bytes");

        if (range) {
          const match = range.match(/bytes=(\d*)-(\d*)/);
          const start = match?.[1] ? Number(match[1]) : 0;
          const end = match?.[2] ? Number(match[2]) : fileStat.size - 1;
          if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= fileStat.size) {
            res.statusCode = 416;
            res.setHeader("Content-Range", `bytes */${fileStat.size}`);
            res.end();
            return;
          }
          res.statusCode = 206;
          res.setHeader("Content-Range", `bytes ${start}-${end}/${fileStat.size}`);
          res.setHeader("Content-Length", String(end - start + 1));
          createReadStream(target, { end, start }).pipe(res);
          return;
        }

        res.statusCode = 200;
        res.setHeader("Content-Length", String(fileStat.size));
        createReadStream(target).pipe(res);
      } catch (error) {
        jsonResponse(res, 404, { error: error instanceof Error ? error.message : "Media not found." });
      }
    });
  }
});

export default defineConfig({
  plugins: [edgeTtsDevProxy(), reelsDevApi(), react()],
  server: {
    allowedHosts: [".trycloudflare.com"],
    port: 5173
  }
});
