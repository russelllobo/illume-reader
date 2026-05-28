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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  try {
    const payload = await req.json();
    const { code, redirectUri, clientId, refreshToken } = payload;

    if (!code && !refreshToken) throw new Error("Missing authorization code or refresh token");
    if (code && !redirectUri) throw new Error("Missing redirectUri");
    if (!clientId) throw new Error("Missing clientId");

    const clientSecret = requiredEnv("GOOGLE_CLIENT_SECRET");
    const tokenBody = refreshToken
      ? new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: "refresh_token",
          refresh_token: refreshToken
        })
      : new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code"
        });

    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: tokenBody
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error_description || result.error || "Failed to exchange token with Google");
    }

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Token exchange failed" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
