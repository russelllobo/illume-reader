import { pool } from './database.mjs';
import { requireOwner, requireUser } from './auth.mjs';

// Local port of the social/content-integration Supabase Edge Functions:
// youtube-token-exchange, youtube-feed, youtube-analytics,
// instagram-token-exchange, instagram-feed, tiktok-token-exchange,
// tiktok-feed, and the read/status paths of reels-post.
//
// Conventions match server/images.mjs: Web Request in, Web Response out,
// local auth via server/auth.mjs, token storage via pool queries against the
// local dashboard-connection tables. Provider OAuth/feed algorithms are kept
// from the original functions; only Auth/REST Supabase fetches were replaced.
//
// Publishing to social accounts stays DISABLED: every mutating reels-post
// path returns 403. Feed/analytics/token-exchange read paths work.
//
// Client OAuth redirect URIs are built from SITE_URL (falling back to
// PUBLIC_URL): {SITE_URL}/auth/youtube/callback,
// {SITE_URL}/auth/instagram/callback, {SITE_URL}/auth/tiktok/callback.
// Those exact URLs must be registered in each provider dashboard.

const DEFAULT_CHANNEL_HANDLE = '@ilumereader';
const INSTAGRAM_GRAPH_VERSION = () => process.env.INSTAGRAM_GRAPH_VERSION || 'v25.0';

const siteBase = () => (process.env.SITE_URL || process.env.PUBLIC_URL || 'http://127.0.0.1').replace(/\/+$/, '');

const json = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

const methodNotAllowed = () => json({ error: 'Method not allowed' }, 405);

function missingEnv(name) {
  return Object.assign(new Error(`Missing ${name}. Set it in the server environment to enable this integration.`), { statusCode: 503 });
}

function fail(error, fallback = 'Request failed.') {
  const status = error.statusCode || 400;
  return json({ error: status >= 500 ? fallback : error.message }, status);
}

function failWith(error, fallback) {
  const status = error.statusCode || 400;
  // Missing-secret (503) messages name the env var; always preserve them.
  const message = status === 503 || status < 500 ? error.message : fallback;
  return json({ error: message }, status);
}

// ---------- dashboard-connection storage (local pool, replaces Supabase REST) ----------

async function loadConnection(table, columns) {
  const { rows } = await pool.query(`SELECT ${columns} FROM ${table} WHERE id='owner' LIMIT 1`);
  return rows[0] ?? null;
}

async function storeYoutubeConnection(channelHandle, refreshToken) {
  await pool.query(
    `INSERT INTO youtube_dashboard_connection(id, channel_handle, refresh_token, updated_at)
     VALUES('owner',$1,$2,now())
     ON CONFLICT(id) DO UPDATE SET channel_handle=excluded.channel_handle, refresh_token=excluded.refresh_token, updated_at=now()`,
    [channelHandle, refreshToken]
  );
}

async function storeInstagramConnection(values) {
  await pool.query(
    `INSERT INTO instagram_dashboard_connection(id, access_token, expires_at, instagram_user_id, username, updated_at)
     VALUES('owner',$1,$2,$3,$4,now())
     ON CONFLICT(id) DO UPDATE SET access_token=excluded.access_token, expires_at=excluded.expires_at,
       instagram_user_id=excluded.instagram_user_id, username=excluded.username, updated_at=now()`,
    [values.access_token, values.expires_at ?? null, values.instagram_user_id ?? null, values.username ?? null]
  );
}

async function storeTiktokConnection(values) {
  await pool.query(
    `INSERT INTO tiktok_dashboard_connection(id, access_token, refresh_token, expires_at, refresh_expires_at, open_id, display_name, updated_at)
     VALUES('owner',$1,$2,$3,$4,$5,$6,now())
     ON CONFLICT(id) DO UPDATE SET access_token=excluded.access_token, refresh_token=excluded.refresh_token,
       expires_at=excluded.expires_at, refresh_expires_at=excluded.refresh_expires_at,
       open_id=excluded.open_id, display_name=excluded.display_name, updated_at=now()`,
    [values.access_token, values.refresh_token ?? null, values.expires_at ?? null,
      values.refresh_expires_at ?? null, values.open_id ?? null, values.display_name ?? null]
  );
}

const tokenExpiry = seconds => {
  const value = Number(seconds ?? 0);
  return value > 0 ? new Date(Date.now() + value * 1000).toISOString() : null;
};

// ---------- YouTube ----------

const youtubeChannelLookup = value => {
  const rawValue = String(value ?? '').trim();
  if (!rawValue) return null;
  let text = rawValue;
  if (rawValue.startsWith('http://') || rawValue.startsWith('https://')) {
    try { text = new URL(rawValue).pathname; } catch { text = rawValue; }
  }
  const parts = text.split('/').filter(Boolean);
  const lastPart = parts.at(-1) ?? text;
  if (lastPart.startsWith('@')) return { key: 'forHandle', value: lastPart };
  if (parts[0] === 'channel' && parts[1]) return { key: 'id', value: parts[1] };
  if (parts[0] === 'user' && parts[1]) return { key: 'forUsername', value: parts[1] };
  if (rawValue.startsWith('UC')) return { key: 'id', value: rawValue };
  if (rawValue.startsWith('@')) return { key: 'forHandle', value: rawValue };
  return { key: 'forHandle', value: `@${rawValue}` };
};

const parseISO8601Duration = duration => {
  if (!duration) return '10:00';
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return '10:00';
  const hours = parseInt(match[1] ?? '0', 10);
  const minutes = parseInt(match[2] ?? '0', 10);
  const seconds = parseInt(match[3] ?? '0', 10);
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

const formatTimeAgo = dateStr => {
  if (!dateStr) return '';
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  let interval = Math.floor(seconds / 31536000);
  if (interval >= 1) return `${interval} year${interval > 1 ? 's' : ''} ago`;
  interval = Math.floor(seconds / 2592000);
  if (interval >= 1) return `${interval} month${interval > 1 ? 's' : ''} ago`;
  interval = Math.floor(seconds / 604800);
  if (interval >= 1) return `${interval} week${interval > 1 ? 's' : ''} ago`;
  interval = Math.floor(seconds / 86400);
  if (interval >= 1) return `${interval} day${interval > 1 ? 's' : ''} ago`;
  interval = Math.floor(seconds / 3600);
  if (interval >= 1) return `${interval} hour${interval > 1 ? 's' : ''} ago`;
  interval = Math.floor(seconds / 60);
  if (interval >= 1) return `${interval} minute${interval > 1 ? 's' : ''} ago`;
  return 'just now';
};

const chunks = (items, size) => {
  const groups = [];
  for (let index = 0; index < items.length; index += size) groups.push(items.slice(index, index + size));
  return groups;
};

export async function youtubeTokenExchange(request) {
  try {
    if (request.method !== 'POST') return methodNotAllowed();
    await requireUser(request);
    const payload = await request.json().catch(() => ({}));
    const { code, refreshToken } = payload;
    const clientId = payload.clientId || process.env.GOOGLE_CLIENT_ID;
    const redirectUri = payload.redirectUri || `${siteBase()}/auth/youtube/callback`;
    if (!code && !refreshToken) throw Object.assign(new Error('Missing authorization code or refresh token.'), { statusCode: 400 });
    if (code && !redirectUri) throw Object.assign(new Error('Missing redirectUri.'), { statusCode: 400 });
    if (!clientId) throw Object.assign(new Error('Missing Google client ID. Set GOOGLE_CLIENT_ID.'), { statusCode: 400 });
    if (!process.env.GOOGLE_CLIENT_SECRET) throw missingEnv('GOOGLE_CLIENT_SECRET');

    const tokenBody = refreshToken
      ? new URLSearchParams({ client_id: clientId, client_secret: process.env.GOOGLE_CLIENT_SECRET, grant_type: 'refresh_token', refresh_token: refreshToken })
      : new URLSearchParams({ code, client_id: clientId, client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: redirectUri, grant_type: 'authorization_code' });
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenBody
    });
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result.error_description || result.error || 'Failed to exchange token with Google.'), { statusCode: 400 });

    if (result.refresh_token) {
      const channel = typeof payload.channel === 'string' && payload.channel.trim()
        ? payload.channel.trim()
        : process.env.YOUTUBE_CHANNEL_ID || DEFAULT_CHANNEL_HANDLE;
      await storeYoutubeConnection(channel, result.refresh_token);
    }
    return json(result);
  } catch (error) {
    return failWith(error, 'YouTube token exchange failed.');
  }
}

export async function youtubeFeed(request) {
  try {
    if (request.method !== 'POST') return methodNotAllowed();
    await requireUser(request);
    const payload = await request.json().catch(() => ({}));
    if (!process.env.YOUTUBE_API_KEY) throw missingEnv('YOUTUBE_API_KEY');
    const apiKey = process.env.YOUTUBE_API_KEY;
    const channelValue = typeof payload.channel === 'string' && payload.channel.trim()
      ? payload.channel.trim()
      : typeof payload.channelId === 'string' && payload.channelId.trim()
        ? payload.channelId.trim()
        : process.env.YOUTUBE_CHANNEL_ID ?? '';
    const lookup = youtubeChannelLookup(channelValue);
    if (!lookup) throw Object.assign(new Error('Enter a YouTube channel URL, @handle, or channel ID before fetching content.'), { statusCode: 400 });

    const channelUrl = new URL('https://youtube.googleapis.com/youtube/v3/channels');
    channelUrl.searchParams.set('part', 'contentDetails');
    channelUrl.searchParams.set(lookup.key, lookup.value);
    channelUrl.searchParams.set('key', apiKey);
    const channelRes = await fetch(channelUrl);
    const channelData = await channelRes.json();
    if (!channelRes.ok) throw new Error(channelData.error?.message || 'Failed to retrieve YouTube channel.');
    if (!channelData.items?.length) {
      throw new Error(`No YouTube channel found for ${channelValue}. Use the channel URL, @handle, or UC... channel ID.`);
    }
    const uploadsPlaylist = channelData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploadsPlaylist) throw new Error('No uploads playlist associated with this YouTube channel.');

    const items = [];
    let pageToken = '';
    do {
      const playlistUrl = new URL('https://youtube.googleapis.com/youtube/v3/playlistItems');
      playlistUrl.searchParams.set('part', 'snippet,contentDetails');
      playlistUrl.searchParams.set('playlistId', uploadsPlaylist);
      playlistUrl.searchParams.set('maxResults', '50');
      playlistUrl.searchParams.set('key', apiKey);
      if (pageToken) playlistUrl.searchParams.set('pageToken', pageToken);
      const playlistRes = await fetch(playlistUrl);
      const playlistData = await playlistRes.json();
      if (!playlistRes.ok) throw new Error(playlistData.error?.message || 'Failed to fetch upload playlist items.');
      items.push(...(playlistData.items ?? []));
      pageToken = playlistData.nextPageToken ?? '';
    } while (pageToken);

    const videoIds = items.map(item => item.contentDetails?.videoId).filter(Boolean);
    const statsMap = new Map();
    for (const videoIdChunk of chunks(videoIds, 50)) {
      const videosUrl = new URL('https://youtube.googleapis.com/youtube/v3/videos');
      videosUrl.searchParams.set('part', 'contentDetails,statistics');
      videosUrl.searchParams.set('id', videoIdChunk.join(','));
      videosUrl.searchParams.set('key', apiKey);
      const videosRes = await fetch(videosUrl);
      const videosData = await videosRes.json();
      if (!videosRes.ok) throw new Error(videosData.error?.message || 'Failed to retrieve YouTube video statistics.');
      (videosData.items ?? []).forEach(video => {
        statsMap.set(video.id, {
          comments: video.statistics?.commentCount ?? '0',
          duration: parseISO8601Duration(video.contentDetails?.duration),
          likes: video.statistics?.likeCount ?? '0',
          views: video.statistics?.viewCount ?? '0'
        });
      });
    }

    const videos = items.map(item => {
      const videoId = item.contentDetails?.videoId;
      const stats = statsMap.get(videoId) ?? { comments: '0', duration: '10:00', likes: '0', views: '0' };
      return {
        comments: stats.comments,
        duration: stats.duration,
        id: videoId || item.id,
        imageUrl: item.snippet?.thumbnails?.high?.url ?? item.snippet?.thumbnails?.medium?.url ?? '',
        likes: stats.likes,
        publishedAt: item.snippet?.publishedAt ?? '',
        published: formatTimeAgo(item.snippet?.publishedAt),
        title: item.snippet?.title ?? 'Untitled Video',
        views: stats.views
      };
    });
    return json({ channel: channelValue, videos });
  } catch (error) {
    return failWith(error, 'Could not load YouTube feed.');
  }
}

const isoDate = date => date.toISOString().slice(0, 10);
const DAY_MS = 24 * 60 * 60 * 1000;
const dateFromIsoDate = value => {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
};
const addDays = (date, days) => new Date(date.getTime() + days * DAY_MS);
const mondayOfWeek = date => {
  const monday = new Date(date);
  const daysSinceMonday = (monday.getUTCDay() + 6) % 7;
  monday.setUTCDate(monday.getUTCDate() - daysSinceMonday);
  return monday;
};

const analyticsRequest = async (accessToken, query) => {
  const url = new URL('https://youtubeanalytics.googleapis.com/v2/reports');
  Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message || 'Failed to load YouTube Analytics.');
  return body;
};

const rowObject = (headers, row) => Object.fromEntries(headers.map((header, index) => [header.name, row[index] ?? null]));
const sumMetric = (rows, key) => rows.reduce((total, row) => total + Number(row[key] ?? 0), 0);
const weightedAverage = (rows, key) => {
  const views = sumMetric(rows, 'views');
  if (!views) return 0;
  return rows.reduce((total, row) => total + Number(row[key] ?? 0) * Number(row.views ?? 0), 0) / views;
};
const latestRowDate = (rows, fallback) => rows.reduce((latest, row) => {
  const day = String(row.day ?? '');
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && day > latest ? day : latest;
}, '') || fallback;
const weeklyViewTallies = (rows, startDate, endDate) => {
  const start = dateFromIsoDate(startDate);
  const end = dateFromIsoDate(endDate);
  let cursor = mondayOfWeek(start);
  const tallies = [];
  while (cursor <= end) {
    const weekStart = new Date(cursor);
    const weekEnd = new Date(Math.min(addDays(weekStart, 6).getTime(), end.getTime()));
    const startIso = isoDate(weekStart);
    const endIso = isoDate(weekEnd);
    const views = rows.reduce((total, row) => {
      const day = String(row.day ?? '');
      return day >= startIso && day <= endIso ? total + Number(row.views ?? 0) : total;
    }, 0);
    tallies.push({ endDate: endIso, startDate: startIso, views });
    cursor = addDays(cursor, 7);
  }
  return tallies;
};

const refreshGoogleAccessToken = async refreshToken => {
  if (!process.env.GOOGLE_CLIENT_ID) throw missingEnv('GOOGLE_CLIENT_ID');
  if (!process.env.GOOGLE_CLIENT_SECRET) throw missingEnv('GOOGLE_CLIENT_SECRET');
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    })
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error_description || body.error || 'Failed to refresh YouTube access.');
  return body.access_token;
};

export async function youtubeAnalytics(request) {
  try {
    if (request.method !== 'POST') return methodNotAllowed();
    await requireOwner(request);
    const payload = await request.json().catch(() => ({}));
    const channelHandle = typeof payload.channel === 'string' && payload.channel.trim()
      ? payload.channel.trim()
      : process.env.YOUTUBE_CHANNEL_ID || DEFAULT_CHANNEL_HANDLE;
    const requestedVideoIds = Array.isArray(payload.videoIds)
      ? payload.videoIds.filter(id => typeof id === 'string' && /^[\w-]+$/.test(id))
      : [];

    if (payload.action === 'store') {
      if (typeof payload.refreshToken !== 'string' || !payload.refreshToken) {
        throw Object.assign(new Error('Google did not return a refresh token. Re-link with consent prompt enabled.'), { statusCode: 400 });
      }
      await storeYoutubeConnection(channelHandle, payload.refreshToken);
      return json({ connected: true, channel: channelHandle });
    }

    const connection = await loadConnection('youtube_dashboard_connection', 'channel_handle, refresh_token');
    const refreshToken = connection?.refresh_token || process.env.YOUTUBE_REFRESH_TOKEN;
    if (!refreshToken) {
      throw Object.assign(new Error('Link Google once to enable private YouTube Analytics metrics. Set YOUTUBE_REFRESH_TOKEN or store a connection.'), { statusCode: 400 });
    }
    const accessToken = await refreshGoogleAccessToken(refreshToken);
    const end = new Date();
    end.setDate(end.getDate() - 1);
    const start = new Date(end);
    start.setDate(start.getDate() - 27);
    const common = { endDate: isoDate(end), ids: 'channel==MINE', startDate: isoDate(start) };

    const dailyReport = await analyticsRequest(accessToken, {
      ...common,
      dimensions: 'day',
      metrics: 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost,engagedViews',
      sort: 'day'
    });
    const dailyRows = (dailyReport.rows ?? []).map(row => rowObject(dailyReport.columnHeaders ?? [], row));
    const availableEndDate = latestRowDate(dailyRows, common.endDate);

    const videoMetrics = 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost,engagedViews';
    const loadVideoRows = async ids => {
      const videoReportQuery = {
        ...common,
        dimensions: 'video',
        maxResults: String(Math.max(5, ids.length || 200)),
        metrics: videoMetrics,
        sort: '-views'
      };
      if (ids.length) videoReportQuery.filters = `video==${ids.join(',')}`;
      const report = await analyticsRequest(accessToken, videoReportQuery);
      return (report.rows ?? []).map(row => ({ ...rowObject(report.columnHeaders ?? [], row), impressions: null, impressionsClickThroughRate: null }));
    };
    const topVideos = requestedVideoIds.length
      ? (await Promise.all(chunks(requestedVideoIds, 50).map(loadVideoRows))).flat()
        .sort((left, right) => Number(right.views ?? 0) - Number(left.views ?? 0))
      : await loadVideoRows([]);

    return json({
      channel: connection?.channel_handle || channelHandle,
      connected: true,
      range: { availableEndDate, endDate: common.endDate, startDate: common.startDate },
      summary: {
        averageViewDuration: weightedAverage(dailyRows, 'averageViewDuration'),
        averageViewPercentage: weightedAverage(dailyRows, 'averageViewPercentage'),
        engagedViews: sumMetric(dailyRows, 'engagedViews'),
        estimatedMinutesWatched: sumMetric(dailyRows, 'estimatedMinutesWatched'),
        subscribersGained: sumMetric(dailyRows, 'subscribersGained'),
        subscribersLost: sumMetric(dailyRows, 'subscribersLost'),
        views: sumMetric(dailyRows, 'views')
      },
      timeline: dailyRows,
      topVideos,
      weeklyViews: weeklyViewTallies(dailyRows, common.startDate, availableEndDate)
    });
  } catch (error) {
    return failWith(error, 'Could not load YouTube analytics.');
  }
}

// ---------- Instagram ----------

const instagramErrorMessage = (body, fallback) => {
  const message = body?.error?.message || body?.error_message || (typeof body?.error === 'string' ? body.error : '') || fallback;
  const type = body?.error?.type || body?.error_type;
  const code = body?.error?.code || body?.code;
  const detail = [type, code ? `code ${code}` : ''].filter(Boolean).join(', ');
  return detail ? `${message} (${detail})` : message;
};

const graphGetFrom = async (host, path, token, params = {}) => {
  const url = new URL(`https://graph.${host}.com/${INSTAGRAM_GRAPH_VERSION()}/${path}`);
  url.searchParams.set('access_token', token);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok) {
    const detail = body.error?.message || 'Instagram Graph API request failed.';
    const code = body.error?.code ? ` (#${body.error.code})` : '';
    const subcode = body.error?.error_subcode ? ` subcode ${body.error.error_subcode}` : '';
    throw new Error(`${detail}${code}${subcode}`);
  }
  return body;
};

const graphGet = (path, token, params) => graphGetFrom('instagram', path, token, params);
const facebookGraphGet = (path, token, params) => graphGetFrom('facebook', path, token, params);

const withStage = async (stage, work) => {
  try {
    return await work();
  } catch (error) {
    throw new Error(`${stage}: ${error instanceof Error ? error.message : String(error)}`);
  }
};

const describeReturnedPages = pages => {
  const data = Array.isArray(pages?.data) ? pages.data : [];
  if (!data.length) {
    return 'Facebook returned zero Pages for this login. In the Facebook consent screen, choose the Facebook Page connected to your Instagram professional account and approve all requested Page/Instagram permissions.';
  }
  const pageNames = data.map(page => {
    const ig = page?.instagram_business_account;
    return `${page?.name || page?.id || 'Unnamed Page'}${ig?.id ? ` -> Instagram @${ig.username || ig.id}` : ' -> no connected Instagram professional account returned'}`;
  }).join('; ');
  return `Facebook returned ${data.length} Page(s), but none had a connected Instagram professional account with a Page access token. Returned Pages: ${pageNames}. Make sure the Instagram account is Professional, linked to the selected Facebook Page, and that your Facebook user has full control/task access to that Page.`;
};

const usableInstagramPage = pages => {
  const data = Array.isArray(pages?.data) ? pages.data : [];
  return data.find(item => item.instagram_business_account?.id && item.access_token);
};

const loadBusinessPages = async userToken => {
  const businesses = await graphGetFrom('facebook', 'me/businesses', userToken, { fields: 'id,name', limit: '50' });
  const allPages = [];
  for (const business of businesses.data ?? []) {
    for (const edge of ['owned_pages', 'client_pages']) {
      try {
        const pages = await graphGetFrom('facebook', `${business.id}/${edge}`, userToken, {
          fields: 'id,name,access_token,instagram_business_account{id,username}',
          limit: '100'
        });
        allPages.push(...(pages.data ?? []).map(page => ({ ...page, business: { id: business.id, name: business.name, edge } })));
      } catch (error) {
        console.warn(`Could not load ${edge} for business ${business.id}:`, error instanceof Error ? error.message : String(error));
      }
    }
  }
  return { data: allPages };
};

const exchangeInstagramCode = async (code, redirectUri) => {
  if (!process.env.INSTAGRAM_APP_ID) throw missingEnv('INSTAGRAM_APP_ID');
  if (!process.env.INSTAGRAM_APP_SECRET) throw missingEnv('INSTAGRAM_APP_SECRET');
  const appId = process.env.INSTAGRAM_APP_ID;
  const appSecret = process.env.INSTAGRAM_APP_SECRET;
  const shortUrl = new URL(`https://graph.facebook.com/${INSTAGRAM_GRAPH_VERSION()}/oauth/access_token`);
  shortUrl.searchParams.set('client_id', appId);
  shortUrl.searchParams.set('client_secret', appSecret);
  shortUrl.searchParams.set('code', code);
  shortUrl.searchParams.set('redirect_uri', redirectUri);
  const shortResponse = await fetch(shortUrl);
  const shortBody = await shortResponse.json();
  if (!shortResponse.ok || !shortBody.access_token) {
    throw new Error(instagramErrorMessage(shortBody, 'Could not exchange Instagram authorization code.'));
  }
  const longUrl = new URL(`https://graph.facebook.com/${INSTAGRAM_GRAPH_VERSION()}/oauth/access_token`);
  longUrl.searchParams.set('grant_type', 'fb_exchange_token');
  longUrl.searchParams.set('client_id', appId);
  longUrl.searchParams.set('client_secret', appSecret);
  longUrl.searchParams.set('fb_exchange_token', shortBody.access_token);
  const longResponse = await fetch(longUrl);
  const longBody = await longResponse.json();
  if (!longResponse.ok || !longBody.access_token) {
    console.warn('Could not create long-lived Instagram token; using authorization-code token:', instagramErrorMessage(longBody, 'unknown error'));
    return shortBody;
  }
  return longBody;
};

export async function instagramTokenExchange(request) {
  try {
    if (request.method !== 'POST') return methodNotAllowed();
    await requireOwner(request);
    const payload = await request.json().catch(() => ({}));
    const code = String(payload.code ?? '');
    const redirectUri = String(payload.redirectUri ?? '') || `${siteBase()}/auth/instagram/callback`;
    if (!code) throw Object.assign(new Error('Missing Instagram authorization code.'), { statusCode: 400 });
    if (!redirectUri) throw Object.assign(new Error('Missing Instagram redirect URI.'), { statusCode: 400 });

    const userToken = await withStage('code exchange', () => exchangeInstagramCode(code, redirectUri));
    const pages = await withStage('page lookup', () => graphGetFrom('facebook', 'me/accounts', userToken.access_token, {
      fields: 'id,name,access_token,instagram_business_account{id,username}',
      limit: '25'
    }));
    let page = usableInstagramPage(pages);
    let pageDiagnostics = pages;
    if (!page) {
      const businessPages = await withStage('business page lookup', () => loadBusinessPages(userToken.access_token));
      page = usableInstagramPage(businessPages);
      pageDiagnostics = businessPages.data?.length ? businessPages : pages;
    }
    if (!page) throw Object.assign(new Error(describeReturnedPages(pageDiagnostics)), { statusCode: 400 });

    await storeInstagramConnection({
      access_token: page.access_token,
      expires_at: userToken.expires_in ? new Date(Date.now() + Number(userToken.expires_in) * 1000).toISOString() : null,
      instagram_user_id: page.instagram_business_account.id,
      username: page.instagram_business_account.username ?? null
    });
    return json({ connected: true, page: { id: page.id, name: page.name }, profile: page.instagram_business_account });
  } catch (error) {
    return failWith(error, 'Instagram token exchange failed.');
  }
}

const insightMetricValue = metric => {
  if (typeof metric?.total_value?.value === 'number') return metric.total_value.value;
  const breakdownResults = metric?.total_value?.breakdowns?.flatMap(breakdown => breakdown.results ?? []) ?? [];
  if (breakdownResults.length) return breakdownResults.reduce((total, result) => total + Number(result.value ?? 0), 0);
  if (Array.isArray(metric?.values)) return metric.values.reduce((total, value) => total + Number(value.value ?? 0), 0);
  return 0;
};

const numericMetric = value => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const bestViewTotal = (...values) => Math.max(0, ...values.map(numericMetric));

const inBatches = async (items, size, handler) => {
  const results = [];
  for (let index = 0; index < items.length; index += size) {
    results.push(...await Promise.all(items.slice(index, index + size).map(handler)));
  }
  return results;
};

const accountViewsForDay = async (profileId, accessToken, dayStart, getGraph) => {
  const nextDay = new Date(dayStart.getTime() + DAY_MS);
  const insights = await getGraph(`${profileId}/insights`, accessToken, {
    breakdown: 'media_product_type',
    metric: 'views',
    metric_type: 'total_value',
    period: 'day',
    since: String(Math.floor(dayStart.getTime() / 1000)),
    until: String(Math.floor(nextDay.getTime() / 1000))
  });
  const viewsMetric = (insights.data ?? []).find(m => m.name === 'views');
  return insightMetricValue(viewsMetric);
};

const mediaInsightMetrics = [
  'views', 'reach', 'saved', 'likes', 'comments', 'shares', 'total_interactions',
  'follows', 'profile_visits', 'profile_activity', 'ig_reels_video_view_total_time',
  'ig_reels_avg_watch_time', 'reels_skip_rate'
];

const mediaInsights = async (mediaId, token, getGraph) => {
  const collectValues = data => {
    const values = {};
    data.forEach(metric => {
      values[metric.name] = metric.values?.[0]?.value ?? metric.total_value?.value ?? 0;
    });
    return values;
  };
  try {
    const insights = await getGraph(`${mediaId}/insights`, token, { metric: mediaInsightMetrics.join(',') });
    return collectValues(insights.data ?? []);
  } catch {
    const values = {};
    await Promise.all(mediaInsightMetrics.map(async metric => {
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

const refreshInstagramToken = async token => {
  const url = new URL('https://graph.instagram.com/refresh_access_token');
  url.searchParams.set('grant_type', 'ig_refresh_token');
  url.searchParams.set('access_token', token);
  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok) return null;
  return body;
};

const loadInstagramFeed = async (profilePath, mediaPath, accessToken, getGraph) => {
  const profile = await getGraph(profilePath, accessToken, { fields: 'id,username,media_count' });
  const media = await getGraph(mediaPath, accessToken, {
    fields: 'id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count,total_views_count',
    limit: '12'
  });
  const mediaWithInsights = await Promise.all((media.data ?? []).map(async item => {
    try {
      const values = await mediaInsights(item.id, accessToken, getGraph);
      const views = bestViewTotal(item.total_views_count, values.views);
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
          average_watch_time: 0, comments: item.comments_count ?? 0, follows: 0, likes: item.like_count ?? 0,
          profile_activity: 0, profile_visits: 0, reach: 0, saved: 0, shares: 0, skip_rate: 0,
          total_interactions: 0, total_view_time: 0, total_views: views, views
        },
        _error: err instanceof Error ? err.message : String(err)
      };
    }
  }));

  // Fetch 60 days of daily views so the weekly chart has sufficient history.
  const now = Math.floor(Date.now() / 1000);
  const sixtyDaysAgo = now - 60 * 24 * 60 * 60;
  const userInsightsTimeline = [];
  const userInsightsErrors = [];
  const firstDay = new Date(sixtyDaysAgo * 1000);
  firstDay.setUTCHours(0, 0, 0, 0);
  const lastDay = new Date((now - DAY_MS / 1000) * 1000);
  lastDay.setUTCHours(0, 0, 0, 0);
  const insightDays = [];
  for (let cursor = firstDay; cursor <= lastDay; cursor = new Date(cursor.getTime() + DAY_MS)) insightDays.push(cursor);
  const dailyViews = await inBatches(insightDays, 5, async day => {
    try {
      return { day: isoDate(day), views: await accountViewsForDay(profile.id, accessToken, day, getGraph) };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`Instagram daily views failed for ${isoDate(day)}:`, message);
      userInsightsErrors.push({ day: isoDate(day), error: message });
      return null;
    }
  });
  userInsightsTimeline.push(...dailyViews.filter(Boolean));
  return { connected: true, media: mediaWithInsights, profile, userInsightsErrors, userInsightsTimeline };
};

export async function instagramFeed(request) {
  try {
    if (request.method !== 'POST') return methodNotAllowed();
    await requireOwner(request);
    const stored = await loadConnection('instagram_dashboard_connection', 'access_token, expires_at, instagram_user_id, username');
    if (stored?.access_token && stored.instagram_user_id) {
      try {
        const result = await loadInstagramFeed(stored.instagram_user_id, `${stored.instagram_user_id}/media`, stored.access_token, graphGet);
        await storeInstagramConnection({
          access_token: stored.access_token,
          expires_at: stored.expires_at ?? null,
          instagram_user_id: result.profile.id,
          username: result.profile.username
        });
        return json(result);
      } catch (err) {
        console.warn('Instagram Graph feed failed; trying legacy Facebook Graph token path:', err instanceof Error ? err.message : String(err));
        try {
          const result = await loadInstagramFeed(stored.instagram_user_id, `${stored.instagram_user_id}/media`, stored.access_token, facebookGraphGet);
          await storeInstagramConnection({
            access_token: stored.access_token,
            expires_at: stored.expires_at ?? null,
            instagram_user_id: result.profile.id,
            username: result.profile.username
          });
          return json(result);
        } catch (legacyErr) {
          console.warn('Facebook Graph Instagram feed failed:', legacyErr instanceof Error ? legacyErr.message : String(legacyErr));
        }
        const refreshedLegacyToken = await refreshInstagramToken(stored.access_token);
        if (!refreshedLegacyToken?.access_token) throw err;
      }
    }

    if (!stored?.access_token && !process.env.INSTAGRAM_ACCESS_TOKEN) throw missingEnv('INSTAGRAM_ACCESS_TOKEN');
    let accessToken = stored?.access_token || process.env.INSTAGRAM_ACCESS_TOKEN;
    const refreshed = await refreshInstagramToken(accessToken);
    if (refreshed?.access_token) {
      accessToken = refreshed.access_token;
      const expiresAt = refreshed.expires_in ? new Date(Date.now() + refreshed.expires_in * 1000).toISOString() : null;
      await storeInstagramConnection({ access_token: accessToken, expires_at: expiresAt });
    } else if (!stored?.access_token) {
      await storeInstagramConnection({ access_token: accessToken });
    }
    const result = await loadInstagramFeed('me', 'me/media', accessToken, graphGet);
    await storeInstagramConnection({ access_token: accessToken, instagram_user_id: result.profile.id, username: result.profile.username });
    return json(result);
  } catch (error) {
    return failWith(error, 'Could not load Instagram.');
  }
}

// ---------- TikTok ----------

export async function tiktokTokenExchange(request) {
  try {
    if (request.method !== 'POST') return methodNotAllowed();
    await requireUser(request);
    const payload = await request.json().catch(() => ({}));
    const clientKey = payload.clientKey || process.env.TIKTOK_CLIENT_KEY;
    if (!process.env.TIKTOK_CLIENT_SECRET) throw missingEnv('TIKTOK_CLIENT_SECRET');
    const redirectUri = payload.redirectUri || `${siteBase()}/auth/tiktok/callback`;
    const code = payload.code;
    const codeVerifier = payload.codeVerifier;
    const refreshToken = payload.refreshToken;
    if (!clientKey) throw Object.assign(new Error('Missing TikTok client key. Set TIKTOK_CLIENT_KEY.'), { statusCode: 400 });
    if (!code && !refreshToken) throw Object.assign(new Error('Missing TikTok authorization code or refresh token.'), { statusCode: 400 });
    if (code && !redirectUri) throw Object.assign(new Error('Missing TikTok redirect URI.'), { statusCode: 400 });

    const body = refreshToken
      ? new URLSearchParams({ client_key: clientKey, client_secret: process.env.TIKTOK_CLIENT_SECRET, grant_type: 'refresh_token', refresh_token: refreshToken })
      : new URLSearchParams({
        client_key: clientKey,
        client_secret: process.env.TIKTOK_CLIENT_SECRET,
        code,
        ...(typeof codeVerifier === 'string' && codeVerifier ? { code_verifier: codeVerifier } : {}),
        grant_type: 'authorization_code',
        redirect_uri: redirectUri
      });
    const response = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error_description || result.error || 'Failed to exchange token with TikTok.');

    if (result.access_token) {
      await storeTiktokConnection({
        access_token: result.access_token,
        display_name: null,
        expires_at: tokenExpiry(Number(result.expires_in ?? 0)),
        open_id: result.open_id ?? null,
        refresh_expires_at: tokenExpiry(Number(result.refresh_expires_in ?? 0)),
        refresh_token: typeof result.refresh_token === 'string' ? result.refresh_token : null
      });
    }
    return json(result);
  } catch (error) {
    return failWith(error, 'TikTok token exchange failed.');
  }
}

const refreshTiktokAccessToken = async refreshToken => {
  if (!process.env.TIKTOK_CLIENT_KEY) throw missingEnv('TIKTOK_CLIENT_KEY');
  if (!process.env.TIKTOK_CLIENT_SECRET) throw missingEnv('TIKTOK_CLIENT_SECRET');
  const response = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY,
      client_secret: process.env.TIKTOK_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    })
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error_description || body.error || 'Could not refresh TikTok access.');
  return body;
};

const tiktokRequest = async (path, accessToken, init = {}) => {
  const response = await fetch(`https://open.tiktokapis.com${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) }
  });
  const body = await response.json();
  if (!response.ok || (body.error?.code && body.error.code !== 'ok')) {
    throw new Error(body.error?.message || body.error_description || body.error || 'TikTok API request failed.');
  }
  return body;
};

export async function tiktokFeed(request) {
  try {
    if (request.method !== 'POST') return methodNotAllowed();
    await requireOwner(request);
    const payload = await request.json().catch(() => ({}));

    if (payload.action === 'store') {
      if (typeof payload.accessToken !== 'string' || !payload.accessToken) {
        throw Object.assign(new Error('Missing TikTok access token.'), { statusCode: 400 });
      }
      await storeTiktokConnection({
        access_token: payload.accessToken,
        display_name: payload.displayName ?? null,
        expires_at: tokenExpiry(Number(payload.expiresIn ?? 0)),
        open_id: payload.openId ?? null,
        refresh_expires_at: tokenExpiry(Number(payload.refreshExpiresIn ?? 0)),
        refresh_token: typeof payload.refreshToken === 'string' ? payload.refreshToken : null
      });
      return json({ connected: true });
    }

    let connection = await loadConnection('tiktok_dashboard_connection', 'access_token, refresh_token, expires_at, open_id, display_name');
    if (!connection?.access_token) throw Object.assign(new Error('Link TikTok once to enable TikTok videos.'), { statusCode: 400 });

    let accessToken = connection.access_token;
    const expiresAt = connection.expires_at ? new Date(connection.expires_at).getTime() : 0;
    if (connection.refresh_token && expiresAt && expiresAt - Date.now() < 5 * 60 * 1000) {
      const refreshed = await refreshTiktokAccessToken(connection.refresh_token);
      accessToken = refreshed.access_token;
      await storeTiktokConnection({
        access_token: accessToken,
        expires_at: tokenExpiry(Number(refreshed.expires_in ?? 0)),
        open_id: refreshed.open_id ?? connection.open_id ?? null,
        refresh_expires_at: tokenExpiry(Number(refreshed.refresh_expires_in ?? 0)),
        refresh_token: refreshed.refresh_token ?? connection.refresh_token
      });
      connection = await loadConnection('tiktok_dashboard_connection', 'access_token, refresh_token, expires_at, open_id, display_name');
    }

    const profile = await tiktokRequest('/v2/user/info/?fields=open_id,avatar_url,display_name,profile_deep_link,bio_description', accessToken, { method: 'GET' })
      .catch(() => null);
    const fields = ['id', 'title', 'video_description', 'duration', 'cover_image_url', 'embed_link', 'share_url',
      'create_time', 'like_count', 'comment_count', 'share_count', 'view_count'].join(',');
    const videos = [];
    let cursor;
    let hasMore = true;
    while (hasMore && videos.length < 200) {
      const listBody = { max_count: 20 };
      if (cursor) listBody.cursor = cursor;
      const response = await tiktokRequest(`/v2/video/list/?fields=${fields}`, accessToken, { body: JSON.stringify(listBody), method: 'POST' });
      videos.push(...(response.data?.videos ?? []));
      cursor = response.data?.cursor;
      hasMore = Boolean(response.data?.has_more && cursor);
    }
    return json({
      connected: true,
      profile: profile?.data?.user ?? { display_name: connection?.display_name ?? null, open_id: connection?.open_id ?? null },
      videos
    });
  } catch (error) {
    return failWith(error, 'Could not load TikTok feed.');
  }
}

// ---------- reels-post: status/read paths only; publishing stays disabled ----------

const PUBLISHING_DISABLED = 'Social publishing is not enabled on this server.';

async function reelsStatus() {
  const [youtube, instagram, tiktok] = await Promise.all([
    loadConnection('youtube_dashboard_connection', 'channel_handle'),
    loadConnection('instagram_dashboard_connection', 'instagram_user_id, username'),
    loadConnection('tiktok_dashboard_connection', 'open_id, display_name')
  ]);
  return {
    connected: { youtube: Boolean(youtube), instagram: Boolean(instagram), tiktok: Boolean(tiktok) },
    instagram: instagram ? { instagram_user_id: instagram.instagram_user_id, username: instagram.username } : null,
    publishingEnabled: false,
    tiktok: tiktok ? { display_name: tiktok.display_name, open_id: tiktok.open_id } : null,
    youtube: youtube ? { channel_handle: youtube.channel_handle } : null
  };
}

export async function reelsPost(request) {
  try {
    await requireOwner(request);
    if (request.method === 'GET') return json(await reelsStatus());
    if (request.method !== 'POST') return methodNotAllowed();
    const payload = await request.json().catch(() => ({}));
    if (payload.action === 'status') return json(await reelsStatus());
    // All actual publishing/posting paths stay disabled: YouTube Shorts upload,
    // Instagram reel container creation/publish, TikTok video draft upload and
    // TikTok slideshow post/draft all require a separate explicit instruction.
    return json({ error: PUBLISHING_DISABLED }, 403);
  } catch (error) {
    return fail(error, 'Reel status check failed.');
  }
}
