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
    throw new Error(instagramErrorMessage(body, "Facebook Graph API request failed."));
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

const instagramErrorMessage = (body: any, fallback: string) => {
  const message =
    body?.error?.message ||
    body?.error_message ||
    (typeof body?.error === "string" ? body.error : "") ||
    fallback;
  const type = body?.error?.type || body?.error_type;
  const code = body?.error?.code || body?.code;
  const detail = [type, code ? `code ${code}` : ""].filter(Boolean).join(", ");
  return detail ? `${message} (${detail})` : message;
};

const describeReturnedPages = (pages: any) => {
  const data = Array.isArray(pages?.data) ? pages.data : [];
  if (!data.length) {
    return "Facebook returned zero Pages for this login. In the Facebook consent screen, choose the Facebook Page connected to your Instagram professional account and approve all requested Page/Instagram permissions.";
  }

  const pageNames = data
    .map((page: any) => {
      const ig = page?.instagram_business_account;
      return `${page?.name || page?.id || "Unnamed Page"}${ig?.id ? ` -> Instagram @${ig.username || ig.id}` : " -> no connected Instagram professional account returned"}`;
    })
    .join("; ");

  return `Facebook returned ${data.length} Page(s), but none had a connected Instagram professional account with a Page access token. Returned Pages: ${pageNames}. Make sure the Instagram account is Professional, linked to the selected Facebook Page, and that your Facebook user has full control/task access to that Page.`;
};

const usableInstagramPage = (pages: any) => {
  const data = Array.isArray(pages?.data) ? pages.data : [];
  return data.find((item: any) => item.instagram_business_account?.id && item.access_token);
};

const loadBusinessPages = async (userToken: string) => {
  const businesses = await graphGet("me/businesses", userToken, {
    fields: "id,name",
    limit: "50"
  });
  const allPages: any[] = [];

  for (const business of businesses.data ?? []) {
    for (const edge of ["owned_pages", "client_pages"]) {
      try {
        const pages = await graphGet(`${business.id}/${edge}`, userToken, {
          fields: "id,name,access_token,instagram_business_account{id,username}",
          limit: "100"
        });
        allPages.push(...(pages.data ?? []).map((page: any) => ({
          ...page,
          business: { id: business.id, name: business.name, edge }
        })));
      } catch (error) {
        console.warn(`Could not load ${edge} for business ${business.id}:`, error instanceof Error ? error.message : String(error));
      }
    }
  }

  return { data: allPages };
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
    throw new Error(instagramErrorMessage(shortBody, "Could not exchange Instagram authorization code."));
  }

  const longUrl = new URL(`https://graph.facebook.com/${INSTAGRAM_GRAPH_VERSION}/oauth/access_token`);
  longUrl.searchParams.set("grant_type", "fb_exchange_token");
  longUrl.searchParams.set("client_id", appId);
  longUrl.searchParams.set("client_secret", appSecret);
  longUrl.searchParams.set("fb_exchange_token", shortBody.access_token);

  const longResponse = await fetch(longUrl);
  const longBody = await longResponse.json();
  if (!longResponse.ok || !longBody.access_token) {
    console.warn("Could not create long-lived Instagram token; using authorization-code token:", instagramErrorMessage(longBody, "unknown error"));
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
    let page = usableInstagramPage(pages);
    let pageDiagnostics = pages;
    if (!page) {
      const businessPages = await withStage("business page lookup", () => loadBusinessPages(userToken.access_token));
      page = usableInstagramPage(businessPages);
      pageDiagnostics = businessPages.data?.length ? businessPages : pages;
    }
    if (!page) {
      throw new Error(describeReturnedPages(pageDiagnostics));
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
