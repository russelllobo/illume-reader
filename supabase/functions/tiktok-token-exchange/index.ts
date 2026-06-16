import "jsr:@supabase/functions-js/edge-runtime.d.ts";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const payload = await req.json().catch(() => ({}));
    const clientKey = payload.clientKey || Deno.env.get("TIKTOK_CLIENT_KEY");
    const clientSecret = requiredEnv("TIKTOK_CLIENT_SECRET");
    const redirectUri = payload.redirectUri;
    const code = payload.code;
    const codeVerifier = payload.codeVerifier;
    const refreshToken = payload.refreshToken;

    if (!clientKey) throw new Error("Missing TikTok client key.");
    if (!code && !refreshToken) throw new Error("Missing TikTok authorization code or refresh token.");
    if (code && !redirectUri) throw new Error("Missing TikTok redirect URI.");

    const body = refreshToken
      ? new URLSearchParams({
          client_key: clientKey,
          client_secret: clientSecret,
          grant_type: "refresh_token",
          refresh_token: refreshToken
        })
      : new URLSearchParams({
          client_key: clientKey,
          client_secret: clientSecret,
          code,
          ...(typeof codeVerifier === "string" && codeVerifier ? { code_verifier: codeVerifier } : {}),
          grant_type: "authorization_code",
          redirect_uri: redirectUri
        });

    const response = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error_description || result.error || "Failed to exchange token with TikTok.");

    return jsonResponse(result);
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "TikTok token exchange failed." }, 400);
  }
});
