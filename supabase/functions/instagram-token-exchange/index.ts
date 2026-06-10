import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ADMIN_EMAIL = "r.lobo2003@gmail.com";

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const INSTAGRAM_GRAPH_VERSION = Deno.env.get("INSTAGRAM_GRAPH_VERSION") || "v25.0";

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

const graphGet = async (path: string, token: string, params: Record<string, string> = {}) => {
  const url = new URL(`https://graph.facebook.com/${INSTAGRAM_GRAPH_VERSION}/${path}`);
  url.searchParams.set("access_token", token);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));

  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error?.message || "Facebook Graph API request failed.");
  }
  return body;
};

const withStage = async <T,>(stage: string, work: () => Promise<T>) => {
  try {
    return await work();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${stage}: ${message}`);
  }
};

const exchangeCode = async (code: string, redirectUri: string) => {
  const appId = requiredEnv("INSTAGRAM_APP_ID");
  const appSecret = requiredEnv("INSTAGRAM_APP_SECRET");
  const shortUrl = new URL(`https://graph.facebook.com/${INSTAGRAM_GRAPH_VERSION}/oauth/access_token`);
  shortUrl.searchParams.set("client_id", appId);
  shortUrl.searchParams.set("client_secret", appSecret);
  shortUrl.searchParams.set("code", code);
  shortUrl.searchParams.set("redirect_uri", redirectUri);

  const shortResponse = await fetch(shortUrl);
  const shortBody = await shortResponse.json();
  if (!shortResponse.ok || !shortBody.access_token) {
    throw new Error(shortBody.error?.message || "Could not exchange Instagram authorization code.");
  }

  const longUrl = new URL(`https://graph.facebook.com/${INSTAGRAM_GRAPH_VERSION}/oauth/access_token`);
  longUrl.searchParams.set("grant_type", "fb_exchange_token");
  longUrl.searchParams.set("client_id", appId);
  longUrl.searchParams.set("client_secret", appSecret);
  longUrl.searchParams.set("fb_exchange_token", shortBody.access_token);

  const longResponse = await fetch(longUrl);
  const longBody = await longResponse.json();
  if (!longResponse.ok || !longBody.access_token) {
    console.warn("Could not create long-lived Instagram token; using authorization-code token:", longBody.error?.message || longBody.error || "unknown error");
    return shortBody as { access_token: string; expires_in?: number };
  }

  return longBody as { access_token: string; expires_in?: number };
};

const storeConnection = async (
  supabaseUrl: string,
  serviceRoleKey: string,
  values: { access_token: string; expires_at?: string | null; instagram_user_id?: string | null; username?: string | null }
) => {
  const response = await fetch(`${supabaseUrl}/rest/v1/instagram_dashboard_connection?on_conflict=id`, {
    body: JSON.stringify({ id: "owner", updated_at: new Date().toISOString(), ...values }),
    headers: { ...serviceHeaders(serviceRoleKey), Prefer: "resolution=merge-duplicates" },
    method: "POST"
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message || "Could not save Instagram connection.");
  }
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const authorization = req.headers.get("authorization");
    if (!authorization) return jsonResponse({ error: "Sign in before linking Instagram." }, 401);

    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const anonKey = requiredEnv("SUPABASE_ANON_KEY");
    const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const isOwner = await ownerFromAuthHeader(supabaseUrl, anonKey, authorization);
    if (!isOwner) return jsonResponse({ error: "You do not have access to Instagram content." }, 403);

    const payload = await req.json().catch(() => ({}));
    const code = String(payload.code ?? "");
    const redirectUri = String(payload.redirectUri ?? "");
    if (!code) throw new Error("Missing Instagram authorization code.");
    if (!redirectUri) throw new Error("Missing Instagram redirect URI.");

    const userToken = await withStage("code exchange", () => exchangeCode(code, redirectUri));
    const pages = await withStage("page lookup", () => graphGet("me/accounts", userToken.access_token, {
      fields: "id,name,access_token,instagram_business_account{id,username}",
      limit: "25"
    }));
    const page = (pages.data ?? []).find((item: any) => item.instagram_business_account?.id && item.access_token);
    if (!page) {
      throw new Error("No Facebook Page with a connected Instagram professional account was returned.");
    }

    await storeConnection(supabaseUrl, serviceRoleKey, {
      access_token: page.access_token,
      expires_at: userToken.expires_in ? new Date(Date.now() + Number(userToken.expires_in) * 1000).toISOString() : null,
      instagram_user_id: page.instagram_business_account.id,
      username: page.instagram_business_account.username ?? null
    });

    return jsonResponse({
      connected: true,
      page: { id: page.id, name: page.name },
      profile: page.instagram_business_account
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Instagram token exchange failed." }, 400);
  }
});
