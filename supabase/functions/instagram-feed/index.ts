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

const DAY_MS = 24 * 60 * 60 * 1000;
const isoDate = (date: Date) => date.toISOString().slice(0, 10);
const INSTAGRAM_GRAPH_VERSION = Deno.env.get("INSTAGRAM_GRAPH_VERSION") || "v25.0";

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
    `${supabaseUrl}/rest/v1/instagram_dashboard_connection?select=access_token,expires_at,instagram_user_id,username&id=eq.owner&limit=1`,
    { headers: serviceHeaders(serviceRoleKey) }
  );
  const body = await response.json();
  if (!response.ok) throw new Error(body.message || "Could not load Instagram connection.");
  return body[0] as {
    access_token: string;
    expires_at?: string | null;
    instagram_user_id?: string | null;
    username?: string | null;
  } | undefined;
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

const graphGetFrom = async (host: "facebook" | "instagram", path: string, token: string, params: Record<string, string> = {}) => {
  const url = new URL(`https://graph.${host}.com/${INSTAGRAM_GRAPH_VERSION}/${path}`);
  url.searchParams.set("access_token", token);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok) {
    const detail = body.error?.message || "Instagram Graph API request failed.";
    const code = body.error?.code ? ` (#${body.error.code})` : "";
    const subcode = body.error?.error_subcode ? ` subcode ${body.error.error_subcode}` : "";
    throw new Error(`${detail}${code}${subcode}`);
  }
  return body;
};

const graphGet = async (path: string, token: string, params: Record<string, string> = {}) =>
  graphGetFrom("instagram", path, token, params);

const facebookGraphGet = async (path: string, token: string, params: Record<string, string> = {}) =>
  graphGetFrom("facebook", path, token, params);

const insightMetricValue = (metric: any) => {
  if (typeof metric?.total_value?.value === "number") return metric.total_value.value;
  const breakdownResults = metric?.total_value?.breakdowns?.flatMap((breakdown: any) => breakdown.results ?? []) ?? [];
  if (breakdownResults.length) {
    return breakdownResults.reduce((total: number, result: any) => total + Number(result.value ?? 0), 0);
  }
  if (Array.isArray(metric?.values)) {
    return metric.values.reduce((total: number, value: any) => total + Number(value.value ?? 0), 0);
  }
  return 0;
};

const numericMetric = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const bestViewTotal = (...values: unknown[]) =>
  Math.max(0, ...values.map(numericMetric));

const inBatches = async <T, R>(items: T[], size: number, handler: (item: T) => Promise<R>) => {
  const results: R[] = [];
  for (let index = 0; index < items.length; index += size) {
    results.push(...await Promise.all(items.slice(index, index + size).map(handler)));
  }
  return results;
};

type GraphGetter = typeof graphGet;

const accountViewsForDay = async (profileId: string, accessToken: string, dayStart: Date, getGraph: GraphGetter) => {
  const nextDay = new Date(dayStart.getTime() + DAY_MS);
  const insights = await getGraph(`${profileId}/insights`, accessToken, {
    breakdown: "media_product_type",
    metric: "views",
    metric_type: "total_value",
    period: "day",
    since: String(Math.floor(dayStart.getTime() / 1000)),
    until: String(Math.floor(nextDay.getTime() / 1000))
  });
  const viewsMetric = (insights.data ?? []).find((m: any) => m.name === "views");
  return insightMetricValue(viewsMetric);
};

const mediaInsightMetrics = [
  "views",
  "reach",
  "saved",
  "likes",
  "comments",
  "shares",
  "total_interactions",
  "follows",
  "profile_visits",
  "profile_activity",
  "ig_reels_video_view_total_time",
  "ig_reels_avg_watch_time",
  "reels_skip_rate"
];

const mediaInsights = async (mediaId: string, token: string, getGraph: GraphGetter) => {
  const collectValues = (data: any[]) => {
    const values: Record<string, number> = {};
    data.forEach((metric: any) => {
      values[metric.name] = metric.values?.[0]?.value ?? metric.total_value?.value ?? 0;
    });
    return values;
  };

  try {
    const insights = await getGraph(`${mediaId}/insights`, token, {
      metric: mediaInsightMetrics.join(",")
    });
    return collectValues(insights.data ?? []);
  } catch {
    const values: Record<string, number> = {};
    await Promise.all(mediaInsightMetrics.map(async (metric) => {
      try {
        const insights = await getGraph(`${mediaId}/insights`, token, { metric });
        Object.assign(values, collectValues(insights.data ?? []));
      } catch {
        values[metric] = 0;
      }
    }));
    return values;
  }
};

const refreshInstagramToken = async (token: string) => {
  const url = new URL("https://graph.instagram.com/refresh_access_token");
  url.searchParams.set("grant_type", "ig_refresh_token");
  url.searchParams.set("access_token", token);
  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok) return null;
  return body as { access_token: string; expires_in?: number };
};

const loadInstagramFeed = async (
  profilePath: string,
  mediaPath: string,
  accessToken: string,
  getGraph: GraphGetter
) => {
  const profile = await getGraph(profilePath, accessToken, {
    fields: "id,username,media_count"
  });
  const media = await getGraph(mediaPath, accessToken, {
    fields: "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count,total_views_count",
    limit: "12"
  });

  const mediaWithInsights = await Promise.all(
    (media.data ?? []).map(async (item: any) => {
      try {
        const values = await mediaInsights(item.id, accessToken, getGraph);
        const views = bestViewTotal(
          item.total_views_count,
          values.views
        );

        return {
          ...item,
          insights: {
            average_watch_time: values.ig_reels_avg_watch_time ?? 0,
            comments: values.comments ?? item.comments_count ?? 0,
            follows: values.follows ?? 0,
            likes: values.likes ?? item.like_count ?? 0,
            profile_activity: values.profile_activity ?? 0,
            profile_visits: values.profile_visits ?? 0,
            reach: values.reach ?? 0,
            saved: values.saved ?? 0,
            shares: values.shares ?? 0,
            skip_rate: values.reels_skip_rate ?? 0,
            total_interactions: values.total_interactions ?? 0,
            total_view_time: values.ig_reels_video_view_total_time ?? 0,
            total_views: views,
            views
          }
        };
      } catch (err) {
        const views = bestViewTotal(item.total_views_count);
        return {
          ...item,
          insights: {
            average_watch_time: 0,
            comments: item.comments_count ?? 0,
            follows: 0,
            likes: item.like_count ?? 0,
            profile_activity: 0,
            profile_visits: 0,
            reach: 0,
            saved: 0,
            shares: 0,
            skip_rate: 0,
            total_interactions: 0,
            total_view_time: 0,
            total_views: views,
            views
          },
          _error: err instanceof Error ? err.message : String(err)
        };
      }
    })
  );

  // Fetch 60 days of daily views so the weekly chart has sufficient history.
  // Without since/until, Meta's period=day only returns the last 2 days.
  const now = Math.floor(Date.now() / 1000);
  const sixtyDaysAgo = now - 60 * 24 * 60 * 60;

  const userInsightsTimeline: Array<{ day: string; views: number }> = [];
  const userInsightsErrors: Array<{ day: string; error: string }> = [];
  const firstDay = new Date(sixtyDaysAgo * 1000);
  firstDay.setUTCHours(0, 0, 0, 0);
  const lastDay = new Date((now - DAY_MS / 1000) * 1000);
  lastDay.setUTCHours(0, 0, 0, 0);
  const insightDays: Date[] = [];

  for (let cursor = firstDay; cursor <= lastDay; cursor = new Date(cursor.getTime() + DAY_MS)) {
    insightDays.push(cursor);
  }

  const dailyViews = await inBatches(insightDays, 5, async (day) => {
    try {
      return {
        day: isoDate(day),
        views: await accountViewsForDay(profile.id, accessToken, day, getGraph)
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`Instagram daily views failed for ${isoDate(day)}:`, message);
      userInsightsErrors.push({ day: isoDate(day), error: message });
      return null;
    }
  });
  userInsightsTimeline.push(...dailyViews.filter((row): row is { day: string; views: number } => Boolean(row)));

  return {
    connected: true,
    media: mediaWithInsights,
    profile,
    userInsightsErrors,
    userInsightsTimeline
  };
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const authorization = req.headers.get("authorization");
    if (!authorization) return jsonResponse({ error: "Sign in before loading Instagram." }, 401);

    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const anonKey = requiredEnv("SUPABASE_ANON_KEY");
    const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const isOwner = await ownerFromAuthHeader(supabaseUrl, anonKey, authorization);
    if (!isOwner) return jsonResponse({ error: "You do not have access to Instagram content." }, 403);

    const stored = await loadConnection(supabaseUrl, serviceRoleKey);
    if (stored?.access_token && stored.instagram_user_id) {
      try {
        const result = await loadInstagramFeed(
          stored.instagram_user_id,
          `${stored.instagram_user_id}/media`,
          stored.access_token,
          graphGet
        );
        await storeConnection(supabaseUrl, serviceRoleKey, {
          access_token: stored.access_token,
          expires_at: stored.expires_at ?? null,
          instagram_user_id: result.profile.id,
          username: result.profile.username
        });
        return jsonResponse(result);
      } catch (err) {
        console.warn("Instagram Graph feed failed; trying legacy Facebook Graph token path:", err instanceof Error ? err.message : String(err));
        try {
          const result = await loadInstagramFeed(
            stored.instagram_user_id,
            `${stored.instagram_user_id}/media`,
            stored.access_token,
            facebookGraphGet
          );
          await storeConnection(supabaseUrl, serviceRoleKey, {
            access_token: stored.access_token,
            expires_at: stored.expires_at ?? null,
            instagram_user_id: result.profile.id,
            username: result.profile.username
          });
          return jsonResponse(result);
        } catch (legacyErr) {
          console.warn("Facebook Graph Instagram feed failed:", legacyErr instanceof Error ? legacyErr.message : String(legacyErr));
        }
        const refreshedLegacyToken = await refreshInstagramToken(stored.access_token);
        if (!refreshedLegacyToken?.access_token) {
          throw err;
        }
      }
    }

    let accessToken = stored?.access_token || requiredEnv("INSTAGRAM_ACCESS_TOKEN");

    const refreshed = await refreshInstagramToken(accessToken);
    if (refreshed?.access_token) {
      accessToken = refreshed.access_token;
      const expiresAt = refreshed.expires_in
        ? new Date(Date.now() + refreshed.expires_in * 1000).toISOString()
        : null;
      await storeConnection(supabaseUrl, serviceRoleKey, { access_token: accessToken, expires_at: expiresAt });
    } else if (!stored?.access_token) {
      await storeConnection(supabaseUrl, serviceRoleKey, { access_token: accessToken });
    }

    const result = await loadInstagramFeed("me", "me/media", accessToken, graphGet);

    await storeConnection(supabaseUrl, serviceRoleKey, {
      access_token: accessToken,
      instagram_user_id: result.profile.id,
      username: result.profile.username
    });

    return jsonResponse(result);
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Could not load Instagram." }, 400);
  }
});
