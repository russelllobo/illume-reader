import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const ADMIN_EMAIL = "r.lobo2003@gmail.com";
const DEFAULT_CHANNEL_HANDLE = "@ilumereader";

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

const isoDate = (date: Date) => date.toISOString().slice(0, 10);
const DAY_MS = 24 * 60 * 60 * 1000;

const dateFromIsoDate = (value: string) => {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
};

const addDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY_MS);

const mondayOfWeek = (date: Date) => {
  const monday = new Date(date);
  const daysSinceMonday = (monday.getUTCDay() + 6) % 7;
  monday.setUTCDate(monday.getUTCDate() - daysSinceMonday);
  return monday;
};

const analyticsRequest = async (accessToken: string, query: Record<string, string>) => {
  const url = new URL("https://youtubeanalytics.googleapis.com/v2/reports");
  Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, value));

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message || "Failed to load YouTube Analytics.");
  return body;
};

const ownerFromAuthHeader = async (supabaseUrl: string, anonKey: string, authorization: string) => {
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      Authorization: authorization
    }
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.msg || body.message || "Could not verify signed-in user.");
  return body.email?.toLowerCase() === ADMIN_EMAIL;
};

const serviceHeaders = (serviceRoleKey: string) => ({
  apikey: serviceRoleKey,
  Authorization: `Bearer ${serviceRoleKey}`,
  "Content-Type": "application/json"
});

const storeConnection = async (supabaseUrl: string, serviceRoleKey: string, channelHandle: string, refreshToken: string) => {
  const response = await fetch(`${supabaseUrl}/rest/v1/youtube_dashboard_connection?on_conflict=id`, {
    body: JSON.stringify({
      channel_handle: channelHandle,
      id: "owner",
      refresh_token: refreshToken,
      updated_at: new Date().toISOString()
    }),
    headers: {
      ...serviceHeaders(serviceRoleKey),
      Prefer: "resolution=merge-duplicates"
    },
    method: "POST"
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message || "Could not save YouTube connection.");
  }
};

const loadConnection = async (supabaseUrl: string, serviceRoleKey: string) => {
  const response = await fetch(
    `${supabaseUrl}/rest/v1/youtube_dashboard_connection?select=channel_handle,refresh_token&id=eq.owner&limit=1`,
    { headers: serviceHeaders(serviceRoleKey) }
  );
  const body = await response.json();
  if (!response.ok) throw new Error(body.message || "Could not load YouTube connection.");
  return body[0] as { channel_handle: string; refresh_token: string } | undefined;
};

const rowObject = (headers: Array<{ name: string }>, row: unknown[]) =>
  Object.fromEntries(headers.map((header, index) => [header.name, row[index] ?? null]));

const sumMetric = (rows: Array<Record<string, any>>, key: string) =>
  rows.reduce((total, row) => total + Number(row[key] ?? 0), 0);

const weightedAverage = (rows: Array<Record<string, any>>, key: string) => {
  const views = sumMetric(rows, "views");
  if (!views) return 0;
  return rows.reduce((total, row) => total + Number(row[key] ?? 0) * Number(row.views ?? 0), 0) / views;
};

const latestRowDate = (rows: Array<Record<string, any>>, fallback: string) =>
  rows.reduce((latest, row) => {
    const day = String(row.day ?? "");
    return /^\d{4}-\d{2}-\d{2}$/.test(day) && day > latest ? day : latest;
  }, "") || fallback;

const weeklyViewTallies = (rows: Array<Record<string, any>>, startDate: string, endDate: string) => {
  const start = dateFromIsoDate(startDate);
  const end = dateFromIsoDate(endDate);
  let cursor = mondayOfWeek(start);
  const tallies: Array<{ endDate: string; startDate: string; views: number }> = [];

  while (cursor <= end) {
    const weekStart = new Date(cursor);
    const weekEnd = new Date(Math.min(addDays(weekStart, 6).getTime(), end.getTime()));
    const startIso = isoDate(weekStart);
    const endIso = isoDate(weekEnd);
    const views = rows.reduce((total, row) => {
      const day = String(row.day ?? "");
      return day >= startIso && day <= endIso ? total + Number(row.views ?? 0) : total;
    }, 0);

    tallies.push({ endDate: endIso, startDate: startIso, views });
    cursor = addDays(cursor, 7);
  }

  return tallies;
};

const refreshAccessToken = async (refreshToken: string) => {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requiredEnv("GOOGLE_CLIENT_ID"),
      client_secret: requiredEnv("GOOGLE_CLIENT_SECRET"),
      grant_type: "refresh_token",
      refresh_token: refreshToken
    })
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error_description || body.error || "Failed to refresh YouTube access.");
  return body.access_token as string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const authorization = req.headers.get("authorization");
    if (!authorization) return jsonResponse({ error: "Sign in before loading YouTube analytics." }, 401);

    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const anonKey = requiredEnv("SUPABASE_ANON_KEY");
    const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const isOwner = await ownerFromAuthHeader(supabaseUrl, anonKey, authorization);
    if (!isOwner) {
      return jsonResponse({ error: "You do not have access to YouTube analytics." }, 403);
    }

    const payload = await req.json().catch(() => ({}));
    const channelHandle = typeof payload.channel === "string" && payload.channel.trim()
      ? payload.channel.trim()
      : Deno.env.get("YOUTUBE_CHANNEL_ID") || DEFAULT_CHANNEL_HANDLE;
    const requestedVideoIds = Array.isArray(payload.videoIds)
      ? payload.videoIds
        .filter((id: unknown): id is string => typeof id === "string" && /^[\w-]+$/.test(id))
        .slice(0, 50)
      : [];

    if (payload.action === "store") {
      if (typeof payload.refreshToken !== "string" || !payload.refreshToken) {
        throw new Error("Google did not return a refresh token. Re-link with consent prompt enabled.");
      }

      await storeConnection(supabaseUrl, serviceRoleKey, channelHandle, payload.refreshToken);
      return jsonResponse({ connected: true, channel: channelHandle });
    }

    const connection = await loadConnection(supabaseUrl, serviceRoleKey);

    const refreshToken = connection?.refresh_token || Deno.env.get("YOUTUBE_REFRESH_TOKEN");
    if (!refreshToken) {
      throw new Error("Link Google once to enable private YouTube Analytics metrics.");
    }

    const accessToken = await refreshAccessToken(refreshToken);
    const end = new Date();
    end.setDate(end.getDate() - 1);
    const start = new Date(end);
    start.setDate(start.getDate() - 27);

    const common = {
      endDate: isoDate(end),
      ids: "channel==MINE",
      startDate: isoDate(start)
    };

    const dailyReport = await analyticsRequest(accessToken, {
      ...common,
      dimensions: "day",
      metrics: "views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost,engagedViews",
      sort: "day"
    });
    const dailyRows = (dailyReport.rows ?? []).map((row: unknown[]) => rowObject(dailyReport.columnHeaders ?? [], row));
    const availableEndDate = latestRowDate(dailyRows, common.endDate);

    const videoReportQuery: Record<string, string> = {
      ...common,
      dimensions: "video",
      maxResults: String(Math.max(5, requestedVideoIds.length)),
      metrics: "views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost,engagedViews",
      sort: "-views"
    };
    if (requestedVideoIds.length) {
      videoReportQuery.filters = `video==${requestedVideoIds.join(",")}`;
    }

    const topVideosReport = await analyticsRequest(accessToken, videoReportQuery);
    const topVideos = (topVideosReport.rows ?? []).map((row: unknown[]) => ({
      ...rowObject(topVideosReport.columnHeaders ?? [], row),
      impressions: null,
      impressionsClickThroughRate: null
    }));

    return jsonResponse({
      channel: connection?.channel_handle || channelHandle,
      connected: true,
      range: {
        availableEndDate,
        endDate: common.endDate,
        startDate: common.startDate
      },
      summary: {
        averageViewDuration: weightedAverage(dailyRows, "averageViewDuration"),
        averageViewPercentage: weightedAverage(dailyRows, "averageViewPercentage"),
        engagedViews: sumMetric(dailyRows, "engagedViews"),
        estimatedMinutesWatched: sumMetric(dailyRows, "estimatedMinutesWatched"),
        subscribersGained: sumMetric(dailyRows, "subscribersGained"),
        subscribersLost: sumMetric(dailyRows, "subscribersLost"),
        views: sumMetric(dailyRows, "views")
      },
      timeline: dailyRows,
      topVideos,
      weeklyViews: weeklyViewTallies(dailyRows, common.startDate, availableEndDate)
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Could not load YouTube analytics." }, 400);
  }
});
