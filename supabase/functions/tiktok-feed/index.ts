import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ADMIN_EMAIL = "r.lobo2003@gmail.com";

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
  return body.email?.toLowerCase() === ADMIN_EMAIL;
};

const loadConnection = async (supabaseUrl: string, serviceRoleKey: string) => {
  const response = await fetch(
    `${supabaseUrl}/rest/v1/tiktok_dashboard_connection?select=access_token,refresh_token,expires_at,open_id,display_name&id=eq.owner&limit=1`,
    { headers: serviceHeaders(serviceRoleKey) }
  );
  const body = await response.json();
  if (!response.ok) throw new Error(body.message || "Could not load TikTok connection.");
  return body[0] as {
    access_token: string;
    display_name?: string | null;
    expires_at?: string | null;
    open_id?: string | null;
    refresh_token?: string | null;
  } | undefined;
};

const storeConnection = async (
  supabaseUrl: string,
  serviceRoleKey: string,
  values: {
    access_token: string;
    display_name?: string | null;
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
    throw new Error(body.message || "Could not save TikTok connection.");
  }
};

const refreshAccessToken = async (refreshToken: string) => {
  const clientKey = requiredEnv("TIKTOK_CLIENT_KEY");
  const clientSecret = requiredEnv("TIKTOK_CLIENT_SECRET");
  const response = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken
    })
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error_description || body.error || "Could not refresh TikTok access.");
  return body;
};

const tiktokRequest = async (path: string, accessToken: string, init: RequestInit = {}) => {
  const response = await fetch(`https://open.tiktokapis.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {})
    }
  });
  const body = await response.json();
  if (!response.ok || body.error?.code && body.error.code !== "ok") {
    throw new Error(body.error?.message || body.error_description || body.error || "TikTok API request failed.");
  }
  return body;
};

const tokenExpiry = (seconds?: number) =>
  seconds ? new Date(Date.now() + seconds * 1000).toISOString() : null;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const authorization = req.headers.get("authorization");
    if (!authorization) return jsonResponse({ error: "Sign in before loading TikTok." }, 401);

    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const anonKey = requiredEnv("SUPABASE_ANON_KEY");
    const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const isOwner = await ownerFromAuthHeader(supabaseUrl, anonKey, authorization);
    if (!isOwner) return jsonResponse({ error: "You do not have access to TikTok content." }, 403);

    const payload = await req.json().catch(() => ({}));
    if (payload.action === "store") {
      if (typeof payload.accessToken !== "string" || !payload.accessToken) throw new Error("Missing TikTok access token.");
      await storeConnection(supabaseUrl, serviceRoleKey, {
        access_token: payload.accessToken,
        display_name: payload.displayName ?? null,
        expires_at: tokenExpiry(Number(payload.expiresIn ?? 0)),
        open_id: payload.openId ?? null,
        refresh_expires_at: tokenExpiry(Number(payload.refreshExpiresIn ?? 0)),
        refresh_token: typeof payload.refreshToken === "string" ? payload.refreshToken : null
      });
      return jsonResponse({ connected: true });
    }

    let connection = await loadConnection(supabaseUrl, serviceRoleKey);
    if (!connection?.access_token) throw new Error("Link TikTok once to enable TikTok videos.");

    let accessToken = connection.access_token;
    const expiresAt = connection.expires_at ? new Date(connection.expires_at).getTime() : 0;
    if (connection.refresh_token && expiresAt && expiresAt - Date.now() < 5 * 60 * 1000) {
      const refreshed = await refreshAccessToken(connection.refresh_token);
      accessToken = refreshed.access_token;
      await storeConnection(supabaseUrl, serviceRoleKey, {
        access_token: accessToken,
        expires_at: tokenExpiry(Number(refreshed.expires_in ?? 0)),
        open_id: refreshed.open_id ?? connection.open_id ?? null,
        refresh_expires_at: tokenExpiry(Number(refreshed.refresh_expires_in ?? 0)),
        refresh_token: refreshed.refresh_token ?? connection.refresh_token
      });
      connection = await loadConnection(supabaseUrl, serviceRoleKey);
    }

    const profile = await tiktokRequest(
      "/v2/user/info/?fields=open_id,avatar_url,display_name,profile_deep_link,bio_description",
      accessToken,
      { method: "GET" }
    ).catch(() => null);

    const fields = [
      "id",
      "title",
      "video_description",
      "duration",
      "cover_image_url",
      "embed_link",
      "share_url",
      "create_time",
      "like_count",
      "comment_count",
      "share_count",
      "view_count"
    ].join(",");
    const videos: any[] = [];
    let cursor: number | undefined;
    let hasMore = true;

    while (hasMore && videos.length < 200) {
      const body: Record<string, number> = { max_count: 20 };
      if (cursor) body.cursor = cursor;
      const response = await tiktokRequest(`/v2/video/list/?fields=${fields}`, accessToken, {
        body: JSON.stringify(body),
        method: "POST"
      });
      videos.push(...(response.data?.videos ?? []));
      cursor = response.data?.cursor;
      hasMore = Boolean(response.data?.has_more && cursor);
    }

    return jsonResponse({
      connected: true,
      profile: profile?.data?.user ?? {
        display_name: connection?.display_name ?? null,
        open_id: connection?.open_id ?? null
      },
      videos
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Could not load TikTok feed." }, 400);
  }
});
