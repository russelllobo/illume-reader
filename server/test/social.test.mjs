import { createHash } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../database.mjs';
import {
  instagramFeed,
  instagramTokenExchange,
  reelsPost,
  tiktokFeed,
  tiktokTokenExchange,
  youtubeAnalytics,
  youtubeFeed,
  youtubeTokenExchange
} from '../social.mjs';

const hash = token => createHash('sha256').update(token).digest('hex');

const OWNER_TOKEN = 'social-test-owner-token';
const USER_TOKEN = 'social-test-user-token';
const users = {
  [hash(OWNER_TOKEN)]: { id: 'owner-id', email: 'owner@example.com', role: 'owner', created_at: null, last_sign_in_at: null, user_metadata: {}, app_metadata: {} },
  [hash(USER_TOKEN)]: { id: 'user-id', email: 'user@example.com', role: 'authenticated', created_at: null, last_sign_in_at: null, user_metadata: {}, app_metadata: {} }
};

// In-memory dashboard connections + insert log (replaces pool queries).
const state = { youtube: null, instagram: null, tiktok: null, inserts: [] };
let realQuery;
let realFetch;

const post = (handler, body = {}, token = null) => {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  return handler(new Request('http://localhost/api/social', { method: 'POST', headers, body: JSON.stringify(body) }));
};
const get = (handler, token = null) => {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  return handler(new Request('http://localhost/api/social', { method: 'GET', headers }));
};

function installPoolFake() {
  realQuery = pool.query;
  pool.query = async (text, params = []) => {
    if (text.includes('auth_sessions')) {
      const user = users[params[0]];
      return { rows: user ? [user] : [] };
    }
    if (text.includes('youtube_dashboard_connection')) {
      if (text.startsWith('INSERT')) {
        state.inserts.push({ table: 'youtube', channel_handle: params[0], refresh_token: params[1] });
        state.youtube = { channel_handle: params[0], refresh_token: params[1] };
        return { rows: [] };
      }
      return { rows: state.youtube ? [state.youtube] : [] };
    }
    if (text.includes('instagram_dashboard_connection')) {
      if (text.startsWith('INSERT')) {
        state.inserts.push({ table: 'instagram', access_token: params[0] });
        state.instagram = { access_token: params[0], expires_at: params[1], instagram_user_id: params[2], username: params[3] };
        return { rows: [] };
      }
      return { rows: state.instagram ? [state.instagram] : [] };
    }
    if (text.includes('tiktok_dashboard_connection')) {
      if (text.startsWith('INSERT')) {
        state.inserts.push({ table: 'tiktok', access_token: params[0] });
        state.tiktok = { access_token: params[0], refresh_token: params[1], expires_at: params[2], open_id: params[4], display_name: params[5] };
        return { rows: [] };
      }
      return { rows: state.tiktok ? [state.tiktok] : [] };
    }
    return { rows: [] };
  };
}

function installFetchFake() {
  realFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    const target = String(url);
    const ok = body => ({ ok: true, status: 200, headers: new Headers(), json: async () => body });
    if (target.startsWith('https://oauth2.googleapis.com/token')) {
      return ok({ access_token: 'ya29-test', refresh_token: 'google-refresh-test', expires_in: 3600 });
    }
    if (target.includes('youtube.googleapis.com/youtube/v3/channels')) {
      return ok({ items: [{ contentDetails: { relatedPlaylists: { uploads: 'UU123' } } }] });
    }
    if (target.includes('youtube.googleapis.com/youtube/v3/playlistItems')) {
      return ok({ items: [{ id: 'pli1', snippet: { title: 'Vid', publishedAt: '2026-01-01T00:00:00.000Z', thumbnails: { high: { url: 'https://img/v.jpg' } } }, contentDetails: { videoId: 'vid1' } }] });
    }
    if (target.includes('youtube.googleapis.com/youtube/v3/videos')) {
      return ok({ items: [{ id: 'vid1', statistics: { commentCount: '1', likeCount: '2', viewCount: '3' }, contentDetails: { duration: 'PT1M30S' } }] });
    }
    if (target.includes('youtubeanalytics.googleapis.com')) {
      return ok({ columnHeaders: [{ name: 'day' }, { name: 'views' }], rows: [['2026-09-01', 10], ['2026-09-02', 20]] });
    }
    if (target.includes('open.tiktokapis.com/v2/oauth/token/')) {
      return ok({ access_token: 'tt-access', refresh_token: 'tt-refresh', expires_in: 3600, refresh_expires_in: 3600, open_id: 'tt-open' });
    }
    if (target.includes('open.tiktokapis.com/v2/user/info/')) {
      return ok({ data: { user: { display_name: 'TT User', open_id: 'tt-open' } } });
    }
    if (target.includes('open.tiktokapis.com/v2/video/list/')) {
      return ok({ data: { videos: [{ id: 'ttv1' }], has_more: false } });
    }
    if (target.includes('graph.instagram.com/refresh_access_token')) {
      return ok({ access_token: 'ig-refreshed', expires_in: 3600 });
    }
    if (target.includes('/insights')) {
      return ok({ data: [{ name: 'views', total_value: { value: 5 } }] });
    }
    if (target.includes('me/businesses') || target.includes('owned_pages') || target.includes('client_pages')) {
      return ok({ data: [] });
    }
    if (target.includes('me/accounts')) {
      return ok({ data: [{ id: 'page1', name: 'Page', access_token: 'page-token', instagram_business_account: { id: 'ig1', username: 'iguser' } }] });
    }
    if (target.includes('/oauth/access_token')) {
      return ok({ access_token: 'ig-long-lived', expires_in: 3600 });
    }
    if (target.endsWith('/ig1') || target.includes('/ig1?')) {
      return ok({ id: 'ig1', username: 'iguser', media_count: 0 });
    }
    if (target.includes('/ig1/media')) {
      return ok({ data: [] });
    }
    if (target.endsWith('/me') || target.includes('/me?')) {
      return ok({ id: 'ig1', username: 'iguser', media_count: 0 });
    }
    if (target.includes('/me/media')) {
      return ok({ data: [] });
    }
    return ok({});
  };
}

describe('social adapters', { concurrency: 1 }, () => {
  before(() => {
    process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'test-google-client-id';
    process.env.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'test-google-client-secret';
    process.env.YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || 'test-youtube-key';
    process.env.YOUTUBE_CHANNEL_ID = process.env.YOUTUBE_CHANNEL_ID || '@testchannel';
    process.env.INSTAGRAM_APP_ID = process.env.INSTAGRAM_APP_ID || 'test-ig-app-id';
    process.env.INSTAGRAM_APP_SECRET = process.env.INSTAGRAM_APP_SECRET || 'test-ig-app-secret';
    process.env.TIKTOK_CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY || 'test-tt-key';
    process.env.TIKTOK_CLIENT_SECRET = process.env.TIKTOK_CLIENT_SECRET || 'test-tt-secret';
    installPoolFake();
    installFetchFake();
  });

  after(() => {
    pool.query = realQuery;
    globalThis.fetch = realFetch;
  });

  test('all publishing paths return 403', async () => {
    for (const platforms of [['youtube'], ['instagram'], ['tiktok'], ['youtube', 'instagram', 'tiktok']]) {
      const response = await post(reelsPost, { platforms, publicVideoUrl: 'https://cdn.example/v.mp4', description: 'x' }, OWNER_TOKEN);
      assert.equal(response.status, 403, `platforms=${platforms}`);
      const body = await response.json();
      assert.match(body.error, /not enabled/i);
    }
    const slideshow = await post(reelsPost, { platforms: ['tiktok'], tiktokPostType: 'slideshow', tiktokSlideUrls: ['https://cdn.example/1.jpg'] }, OWNER_TOKEN);
    assert.equal(slideshow.status, 403);
  });

  test('reels status/read paths work for the owner', async () => {
    const response = await get(reelsPost, OWNER_TOKEN);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.publishingEnabled, false);
    assert.ok(body.connected);
    const actionStatus = await post(reelsPost, { action: 'status' }, OWNER_TOKEN);
    assert.equal(actionStatus.status, 200);
    const unauthenticated = await post(reelsPost, { action: 'status' });
    assert.equal(unauthenticated.status, 401);
  });

  test('token exchanges reject unauthenticated and bad input', async () => {
    assert.equal((await post(youtubeTokenExchange, { code: 'x' })).status, 401);
    assert.equal((await post(youtubeTokenExchange, {}, OWNER_TOKEN)).status, 400);
    assert.equal((await post(tiktokTokenExchange, { code: 'x' })).status, 401);
    assert.equal((await post(tiktokTokenExchange, {}, OWNER_TOKEN)).status, 400);
    assert.equal((await post(instagramTokenExchange, { code: 'x' })).status, 401);
    assert.equal((await post(instagramTokenExchange, { code: 'x', redirectUri: 'https://site/auth/instagram/callback' }, USER_TOKEN)).status, 403);
    assert.equal((await post(instagramTokenExchange, {}, OWNER_TOKEN)).status, 400);
  });

  test('feed handlers require auth', async () => {
    assert.equal((await post(youtubeFeed, {})).status, 401);
    assert.equal((await post(youtubeAnalytics, {})).status, 401);
    assert.equal((await post(instagramFeed, {})).status, 401);
    assert.equal((await post(tiktokFeed, {})).status, 401);
    assert.equal((await post(youtubeAnalytics, {}, USER_TOKEN)).status, 403);
    assert.equal((await post(instagramFeed, {}, USER_TOKEN)).status, 403);
    assert.equal((await post(tiktokFeed, {}, USER_TOKEN)).status, 403);
  });

  test('youtube feed returns videos with mocked provider', async () => {
    const response = await post(youtubeFeed, {}, USER_TOKEN);
    assert.equal(response.status, 200, await response.clone().text());
    const body = await response.json();
    assert.equal(body.videos.length, 1);
    assert.equal(body.videos[0].id, 'vid1');
    assert.equal(body.videos[0].duration, '1:30');
  });

  test('youtube analytics store + read work with mocked provider', async () => {
    const stored = await post(youtubeAnalytics, { action: 'store', refreshToken: 'rt-owner', channel: '@owner' }, OWNER_TOKEN);
    assert.equal(stored.status, 200);
    assert.deepEqual(await stored.json(), { connected: true, channel: '@owner' });
    const read = await post(youtubeAnalytics, {}, OWNER_TOKEN);
    assert.equal(read.status, 200, await read.clone().text());
    const body = await read.json();
    assert.equal(body.connected, true);
    assert.equal(body.summary.views, 30);
    assert.ok(Array.isArray(body.weeklyViews));
  });

  test('tiktok store + feed work with mocked provider', async () => {
    const stored = await post(tiktokFeed, { action: 'store', accessToken: 'tt-access', openId: 'tt-open' }, OWNER_TOKEN);
    assert.equal(stored.status, 200);
    const read = await post(tiktokFeed, {}, OWNER_TOKEN);
    assert.equal(read.status, 200, await read.clone().text());
    const body = await read.json();
    assert.equal(body.connected, true);
    assert.equal(body.videos.length, 1);
  });

  test('instagram exchange + feed work with mocked provider', async () => {
    const exchanged = await post(instagramTokenExchange, { code: 'ig-code', redirectUri: 'https://site/auth/instagram/callback' }, OWNER_TOKEN);
    assert.equal(exchanged.status, 200, await exchanged.clone().text());
    const read = await post(instagramFeed, {}, OWNER_TOKEN);
    assert.equal(read.status, 200, await read.clone().text());
    assert.equal((await read.json()).connected, true);
  });

  test('missing provider secret returns 503 naming the variable', async () => {
    const saved = process.env.YOUTUBE_API_KEY;
    delete process.env.YOUTUBE_API_KEY;
    try {
      const response = await post(youtubeFeed, {}, USER_TOKEN);
      assert.equal(response.status, 503);
      assert.match((await response.json()).error, /YOUTUBE_API_KEY/);
    } finally {
      process.env.YOUTUBE_API_KEY = saved;
    }
  });
});
