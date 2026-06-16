import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.106.0";

const ADMIN_EMAIL = "r.lobo2003@gmail.com";

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const INSTAGRAM_GRAPH_VERSION = Deno.env.get("INSTAGRAM_GRAPH_VERSION") || "v25.0";
const MAX_SINGLE_TIKTOK_CHUNK = 64 * 1024 * 1024;
const REELS_BUCKET = "reels";
const INSTAGRAM_CONTAINER_POLL_INTERVALS_MS = [3_000, 5_000, 8_000, 12_000, 15_000, 15_000, 15_000];

const requiredEnv = (name: string) => {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });

const serviceHeaders = (serviceRoleKey: string) => ({
  apikey: serviceRoleKey,
  Authorization: `Bearer ${serviceRoleKey}`,
  "Content-Type": "application/json"
});

const ownerFromAuthHeader = async (supabaseUrl: string, anonKey: string, authorization: string) => {
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: authorization }
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.msg || body.message || "Could not verify signed-in user.");
  return {
    id: String(body.id || ""),
    isOwner: body.email?.toLowerCase() === ADMIN_EMAIL
  };
};

const hostedVideoStoragePathForCleanup = (payload: Record<string, unknown>, ownerUserId: string) => {
  if (payload.autoDeleteHostedVideo !== true) return null;
  const path = String(payload.hostedVideoStoragePath || "").trim();
  if (!path || path.includes("..") || path.startsWith("/") || !path.endsWith(".mp4")) return null;
  return path.startsWith(`${ownerUserId}/`) ? path : null;
};

const removeHostedVideo = async (supabaseUrl: string, serviceRoleKey: string, path: string | null) => {
  if (!path) return { deleted: false };

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { error } = await adminClient.storage.from(REELS_BUCKET).remove([path]);
  if (error) {
    return { deleted: false, error: error.message, path };
  }
  return { deleted: true, path };
};

const loadOwnerConnection = async <T,>(supabaseUrl: string, serviceRoleKey: string, table: string, select: string) => {
  const response = await fetch(`${supabaseUrl}/rest/v1/${table}?select=${select}&id=eq.owner&limit=1`, {
    headers: serviceHeaders(serviceRoleKey)
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message || `Could not load ${table}.`);
  return (body[0] as T | undefined) ?? null;
};

const refreshGoogleAccessToken = async (refreshToken: string) => {
  const clientId = requiredEnv("GOOGLE_CLIENT_ID");
  const clientSecret = requiredEnv("GOOGLE_CLIENT_SECRET");
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

const tokenExpiry = (seconds?: number) =>
  seconds ? new Date(Date.now() + seconds * 1000).toISOString() : null;

const storeTikTokConnection = async (
  supabaseUrl: string,
  serviceRoleKey: string,
  values: {
    access_token: string;
    expires_at?: string | null;
    open_id?: string | null;
    refresh_expires_at?: string | null;
    refresh_token?: string | null;
  }
) => {
  const response = await fetch(`${supabaseUrl}/rest/v1/tiktok_dashboard_connection?on_conflict=id`, {
    body: JSON.stringify({ id: "owner", updated_at: new Date().toISOString(), ...values }),
    headers: { ...serviceHeaders(serviceRoleKey), Prefer: "resolution=merge-duplicates" },
    method: "POST"
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message || "Could not save refreshed TikTok connection.");
  }
};

const refreshTikTokAccessToken = async (
  supabaseUrl: string,
  serviceRoleKey: string,
  connection: {
    access_token: string;
    expires_at?: string | null;
    open_id?: string | null;
    refresh_token?: string | null;
  }
) => {
  const expiresAt = connection.expires_at ? new Date(connection.expires_at).getTime() : 0;
  if (!connection.refresh_token || !expiresAt || expiresAt - Date.now() >= 5 * 60 * 1000) {
    return connection.access_token;
  }

  const clientKey = requiredEnv("TIKTOK_CLIENT_KEY");
  const clientSecret = requiredEnv("TIKTOK_CLIENT_SECRET");
  const response = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: connection.refresh_token
    }),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    method: "POST"
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error_description || body.error || "Could not refresh TikTok access.");

  await storeTikTokConnection(supabaseUrl, serviceRoleKey, {
    access_token: body.access_token,
    expires_at: tokenExpiry(Number(body.expires_in ?? 0)),
    open_id: body.open_id ?? connection.open_id ?? null,
    refresh_expires_at: tokenExpiry(Number(body.refresh_expires_in ?? 0)),
    refresh_token: body.refresh_token ?? connection.refresh_token
  });

  return String(body.access_token || "");
};

const requirePublicVideoUrl = (value: unknown) => {
  const url = String(value || "").trim();
  if (!url) throw new Error("Paste a public HTTPS MP4 URL before posting from the live dashboard.");
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw new Error("The video URL must use HTTPS.");
  return parsed.toString();
};

const requirePublicImageUrls = (value: unknown) => {
  if (!Array.isArray(value)) throw new Error("Generate and host slide images before posting a TikTok slideshow.");
  const urls = value.map((item) => String(item || "").trim()).filter(Boolean);
  if (!urls.length) throw new Error("Generate and host slide images before posting a TikTok slideshow.");
  if (urls.length > 35) throw new Error("TikTok photo slideshows support up to 35 images.");
  return urls.map((url) => {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") throw new Error("TikTok slide image URLs must use HTTPS.");
    return parsed.toString();
  });
};

const instagramTokenDiagnostics = async (token: string) => {
  try {
    const appId = requiredEnv("INSTAGRAM_APP_ID");
    const appSecret = requiredEnv("INSTAGRAM_APP_SECRET");
    const debugUrl = new URL(`https://graph.facebook.com/${INSTAGRAM_GRAPH_VERSION}/debug_token`);
    debugUrl.searchParams.set("input_token", token);
    debugUrl.searchParams.set("access_token", `${appId}|${appSecret}`);
    const debugResponse = await fetch(debugUrl);
    const debugBody = await debugResponse.json().catch(() => ({}));

    const meUrl = new URL(`https://graph.facebook.com/${INSTAGRAM_GRAPH_VERSION}/me`);
    meUrl.searchParams.set("fields", "id,name,tasks,instagram_business_account{id,username}");
    meUrl.searchParams.set("access_token", token);
    const meResponse = await fetch(meUrl);
    const meBody = await meResponse.json().catch(() => ({}));

    return {
      debug: {
        app_id: debugBody?.data?.app_id,
        error: debugBody?.error,
        expires_at: debugBody?.data?.expires_at,
        is_valid: debugBody?.data?.is_valid,
        scopes: debugBody?.data?.scopes,
        type: debugBody?.data?.type
      },
      page: meResponse.ok
        ? {
          id: meBody.id,
          instagram_business_account: meBody.instagram_business_account,
          name: meBody.name,
          tasks: meBody.tasks
        }
        : { error: meBody.error ?? meBody }
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
};

const instagramContainerStatus = async (containerId: string, token: string) => {
  const statusUrl = new URL(`https://graph.facebook.com/${INSTAGRAM_GRAPH_VERSION}/${containerId}`);
  statusUrl.searchParams.set("fields", "id,status,status_code");
  statusUrl.searchParams.set("access_token", token);

  const response = await fetch(statusUrl);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Instagram container status failed: ${JSON.stringify({
      diagnostics: await instagramTokenDiagnostics(token),
      graphError: body
    })}`);
  }
  return body;
};

const waitForInstagramContainer = async (containerId: string, token: string) => {
  let lastStatus: Record<string, unknown> | null = null;

  for (const intervalMs of INSTAGRAM_CONTAINER_POLL_INTERVALS_MS) {
    await new Promise((resolvePoll) => setTimeout(resolvePoll, intervalMs));
    const currentStatus = await instagramContainerStatus(containerId, token);
    lastStatus = currentStatus;
    const statusCode = String(currentStatus.status_code || "");

    if (statusCode === "FINISHED") return currentStatus;
    if (statusCode === "ERROR" || statusCode === "EXPIRED") {
      throw new Error(`Instagram container processing failed: ${JSON.stringify({
        diagnostics: await instagramTokenDiagnostics(token),
        graphError: currentStatus
      })}`);
    }
  }

  throw new Error(`Instagram container processing timed out: ${JSON.stringify({
    diagnostics: await instagramTokenDiagnostics(token),
    graphError: lastStatus
  })}`);
};

const fetchHostedVideo = async (publicVideoUrl: string) => {
  const videoResponse = await fetch(publicVideoUrl);
  if (!videoResponse.ok) throw new Error(`Could not fetch hosted video: ${videoResponse.status}`);
  return videoResponse.arrayBuffer();
};

const putTikTokVideoChunk = async (
  uploadUrl: string,
  chunk: ArrayBuffer,
  start: number,
  end: number,
  total: number
) => {
  const response = await fetch(uploadUrl, {
    body: chunk,
    headers: {
      "Content-Length": String(chunk.byteLength),
      "Content-Range": `bytes ${start}-${end}/${total}`,
      "Content-Type": "video/mp4"
    },
    method: "PUT"
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`TikTok video chunk upload failed: HTTP ${response.status}${body ? ` ${body}` : ""}`);
  }
};

const postTikTokJson = async (path: string, accessToken: string, body?: unknown) => {
  const response = await fetch(`https://open.tiktokapis.com${path}`, {
    body: body ? JSON.stringify(body) : undefined,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8"
    },
    method: "POST"
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.error?.code && result.error.code !== "ok") {
    throw new Error(result.error?.message || result.error_description || result.error || `TikTok request failed: ${JSON.stringify(result)}`);
  }
  return result;
};

const tiktokPrivacyLevel = async (accessToken: string, requested: unknown) => {
  const creatorInfo = await postTikTokJson("/v2/post/publish/creator_info/query/", accessToken);
  const options = Array.isArray(creatorInfo.data?.privacy_level_options)
    ? creatorInfo.data.privacy_level_options.map(String)
    : [];
  const requestedValue = String(requested || "");
  if (requestedValue && options.includes(requestedValue)) return requestedValue;
  return options.includes("SELF_ONLY") ? "SELF_ONLY" : options[0] || "SELF_ONLY";
};

const platformErrorMessage = (platform: string, error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  if (platform === "youtube" && /insufficient|ACCESS_TOKEN_SCOPE_INSUFFICIENT|youtube\.videos\.insert/i.test(message)) {
    return "YouTube is linked without upload permission. Go to Sync > YouTube and click Link YouTube upload, then approve the upload scope.";
  }
  if (platform === "instagram" && /invalid platform app/i.test(message)) {
    return "Meta rejected the Instagram app credentials. Use the Meta app ID and secret that have Facebook Login plus Instagram Graph API publishing permissions, then relink Instagram publish.";
  }
  if (platform === "instagram" && /Instagram (container creation|publish) failed:/i.test(message)) {
    return message;
  }
  if (platform === "instagram" && /instagram_business_content_publish|instagram_content_publish|OAuthException|code\":10|permission/i.test(message)) {
    return "Instagram is linked without content publishing permission. In Meta, make sure instagram_content_publish is approved/available for this app, then relink Instagram publish.";
  }
  if (platform === "tiktok" && /scope|permission|video\.upload|access_token/i.test(message)) {
    return "TikTok is linked without posting permission or the token expired. Go to Sync > TikTok, relink TikTok, and approve content posting access.";
  }
  return message;
};

const uploadYouTubeShort = async (
  supabaseUrl: string,
  serviceRoleKey: string,
  payload: Record<string, unknown>,
  publicVideoUrl: string
) => {
  const connection = await loadOwnerConnection<{ refresh_token: string }>(
    supabaseUrl,
    serviceRoleKey,
    "youtube_dashboard_connection",
    "refresh_token"
  );
  if (!connection?.refresh_token) {
    throw new Error("Missing YouTube connection. Re-link YouTube with the upload scope first.");
  }

  const accessToken = await refreshGoogleAccessToken(connection.refresh_token);
  const video = await fetchHostedVideo(publicVideoUrl);

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

const postInstagramReel = async (
  supabaseUrl: string,
  serviceRoleKey: string,
  payload: Record<string, unknown>,
  publicVideoUrl: string
) => {
  const connection = await loadOwnerConnection<{ access_token: string; instagram_user_id?: string | null }>(
    supabaseUrl,
    serviceRoleKey,
    "instagram_dashboard_connection",
    "access_token,instagram_user_id"
  );
  if (!connection?.access_token || !connection.instagram_user_id) {
    throw new Error("Missing Instagram connection. Link an Instagram professional account with publishing permission first.");
  }

  const caption = String(payload.description || "Trying to read a classic without dissociating #reading #classics #bored #art");
  const createParams = new URLSearchParams({
    access_token: connection.access_token,
    caption,
    media_type: "REELS",
    share_to_feed: "true",
    video_url: publicVideoUrl
  });
  const createResponse = await fetch(`https://graph.facebook.com/${INSTAGRAM_GRAPH_VERSION}/${connection.instagram_user_id}/media`, {
    body: createParams,
    method: "POST"
  });
  const createResult = await createResponse.json();
  if (!createResponse.ok) {
    throw new Error(`Instagram container creation failed: ${JSON.stringify({
      diagnostics: await instagramTokenDiagnostics(connection.access_token),
      graphError: createResult
    })}`);
  }

  const containerStatus = await waitForInstagramContainer(String(createResult.id), connection.access_token);

  const publishParams = new URLSearchParams({
    access_token: connection.access_token,
    creation_id: String(createResult.id)
  });
  const publishResponse = await fetch(`https://graph.facebook.com/${INSTAGRAM_GRAPH_VERSION}/${connection.instagram_user_id}/media_publish`, {
    body: publishParams,
    method: "POST"
  });
  const publishResult = await publishResponse.json();
  if (!publishResponse.ok) {
    throw new Error(`Instagram publish failed: ${JSON.stringify({
      diagnostics: await instagramTokenDiagnostics(connection.access_token),
      graphError: publishResult
    })}`);
  }

  return { container: createResult, containerStatus, platform: "instagram", result: publishResult };
};

const uploadTikTokDraft = async (
  supabaseUrl: string,
  serviceRoleKey: string,
  publicVideoUrl: string
) => {
  const connection = await loadOwnerConnection<{
    access_token: string;
    expires_at?: string | null;
    open_id?: string | null;
    refresh_token?: string | null;
  }>(
    supabaseUrl,
    serviceRoleKey,
    "tiktok_dashboard_connection",
    "access_token,expires_at,open_id,refresh_token"
  );
  if (!connection?.access_token) {
    throw new Error("Missing TikTok connection. Link TikTok with content posting permission first.");
  }

  const accessToken = await refreshTikTokAccessToken(supabaseUrl, serviceRoleKey, connection);
  const video = await fetchHostedVideo(publicVideoUrl);
  const videoSize = video.byteLength;
  if (!videoSize) throw new Error("Hosted TikTok video is empty.");

  const chunkSize = videoSize <= MAX_SINGLE_TIKTOK_CHUNK ? videoSize : MAX_SINGLE_TIKTOK_CHUNK;
  const totalChunkCount = Math.max(1, Math.ceil(videoSize / chunkSize));
  const initResponse = await fetch("https://open.tiktokapis.com/v2/post/publish/inbox/video/init/", {
    body: JSON.stringify({
      source_info: {
        chunk_size: chunkSize,
        source: "FILE_UPLOAD",
        total_chunk_count: totalChunkCount,
        video_size: videoSize
      }
    }),
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8"
    },
    method: "POST"
  });
  const result = await initResponse.json().catch(() => ({}));
  if (!initResponse.ok || result.error?.code && result.error.code !== "ok") {
    throw new Error(result.error?.message || result.error_description || result.error || `TikTok upload failed: ${JSON.stringify(result)}`);
  }

  const uploadUrl = result.data?.upload_url;
  if (!uploadUrl) throw new Error(`TikTok did not return an upload URL: ${JSON.stringify(result)}`);

  for (let start = 0; start < videoSize; start += chunkSize) {
    const end = Math.min(start + chunkSize, videoSize) - 1;
    await putTikTokVideoChunk(uploadUrl, video.slice(start, end + 1), start, end, videoSize);
  }

  return {
    message: "Uploaded to your TikTok inbox as a draft. Open TikTok to review and finish posting.",
    platform: "tiktok",
    result,
    status: "draft_uploaded"
  };
};

const uploadTikTokSlideshow = async (
  supabaseUrl: string,
  serviceRoleKey: string,
  payload: Record<string, unknown>
) => {
  const connection = await loadOwnerConnection<{
    access_token: string;
    expires_at?: string | null;
    open_id?: string | null;
    refresh_token?: string | null;
  }>(
    supabaseUrl,
    serviceRoleKey,
    "tiktok_dashboard_connection",
    "access_token,expires_at,open_id,refresh_token"
  );
  if (!connection?.access_token) {
    throw new Error("Missing TikTok connection. Link TikTok with content posting permission first.");
  }

  const accessToken = await refreshTikTokAccessToken(supabaseUrl, serviceRoleKey, connection);
  const photoImages = requirePublicImageUrls(payload.tiktokSlideUrls);
  const postMode = String(payload.tiktokPostMode || "MEDIA_UPLOAD") === "DIRECT_POST" ? "DIRECT_POST" : "MEDIA_UPLOAD";
  const postInfo: Record<string, unknown> = {
    description: String(payload.description || "Trying to read a classic without dissociating #reading #classics #booktok"),
    title: String(payload.title || "reading a classic").slice(0, 90)
  };
  if (postMode === "DIRECT_POST") {
    postInfo.auto_add_music = payload.tiktokAutoAddMusic !== false;
    postInfo.privacy_level = await tiktokPrivacyLevel(accessToken, payload.tiktokPrivacyLevel);
  }

  const result = await postTikTokJson("/v2/post/publish/content/init/", accessToken, {
    media_type: "PHOTO",
    post_info: postInfo,
    post_mode: postMode,
    source_info: {
      photo_cover_index: 0,
      photo_images: photoImages,
      source: "PULL_FROM_URL"
    }
  });

  return {
    message: postMode === "DIRECT_POST"
      ? "Posted the TikTok slideshow with automatic music."
      : "Uploaded the slide images to your TikTok inbox. Open TikTok to add music, edit, and finish posting.",
    platform: "tiktok",
    result,
    status: postMode === "DIRECT_POST" ? "slideshow_posted" : "slideshow_uploaded"
  };
};

const postReel = async (
  supabaseUrl: string,
  serviceRoleKey: string,
  ownerUserId: string,
  payload: Record<string, unknown>
) => {
  const publicVideoUrl = requirePublicVideoUrl(payload.publicVideoUrl);
  const platforms = Array.isArray(payload.platforms) ? payload.platforms.map(String) : ["youtube", "instagram"];
  const cleanupPath = hostedVideoStoragePathForCleanup(payload, ownerUserId);
  const results = [];

  for (const platform of platforms) {
    try {
      if (platform === "youtube") results.push(await uploadYouTubeShort(supabaseUrl, serviceRoleKey, payload, publicVideoUrl));
      else if (platform === "instagram") results.push(await postInstagramReel(supabaseUrl, serviceRoleKey, payload, publicVideoUrl));
      else if (platform === "tiktok") {
        const tiktokPostType = String(payload.tiktokPostType || "slideshow");
        results.push(tiktokPostType === "video"
          ? await uploadTikTokDraft(supabaseUrl, serviceRoleKey, publicVideoUrl)
          : await uploadTikTokSlideshow(supabaseUrl, serviceRoleKey, payload));
      }
    } catch (error) {
      results.push({ error: platformErrorMessage(platform, error), platform });
    }
  }

  return { cleanup: await removeHostedVideo(supabaseUrl, serviceRoleKey, cleanupPath), results };
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const authorization = req.headers.get("authorization");
    if (!authorization) return jsonResponse({ error: "Sign in before posting reels." }, 401);

    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const anonKey = requiredEnv("SUPABASE_ANON_KEY");
    const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const owner = await ownerFromAuthHeader(supabaseUrl, anonKey, authorization);
    if (!owner.isOwner) return jsonResponse({ error: "This posting workflow is only available to the dashboard owner." }, 403);

    const payload = await req.json().catch(() => ({}));
    return jsonResponse(await postReel(supabaseUrl, serviceRoleKey, owner.id, payload));
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Reel posting failed." }, 400);
  }
});
