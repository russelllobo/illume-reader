import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../app.mjs';
import { pool } from '../database.mjs';

const publicUrl = 'https://reader.example.test';
let app;

before(async () => {
  process.env.PUBLIC_URL = publicUrl;
  process.env.GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';
  delete process.env.GOOGLE_CLIENT_SECRET;
  app = await buildApp();
});

after(async () => {
  await app.close();
  await pool.end();
});

function startResponse(response) {
  const cookies = response.headers['set-cookie'];
  const header = Array.isArray(cookies) ? cookies.join(';') : String(cookies ?? '');
  const state = header.match(/illume_oauth=([^;]+)/)?.[1];
  assert.ok(state, 'the sign-in attempt set a browser cookie');
  return { state, cookie: `illume_oauth=${state}`, url: new URL(response.json().url) };
}

describe('google sign-in', () => {
  test('asks Google for a signed identity when no client secret is configured', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/auth/oauth/google', payload: {} });
    assert.equal(response.statusCode, 200, response.body);
    const { url, state } = startResponse(response);
    assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
    assert.equal(url.searchParams.get('client_id'), process.env.GOOGLE_CLIENT_ID);
    assert.equal(url.searchParams.get('redirect_uri'), `${publicUrl}/api/auth/oauth/google/callback`);
    assert.equal(url.searchParams.get('response_type'), 'id_token');
    assert.equal(url.searchParams.get('response_mode'), 'form_post');
    assert.equal(url.searchParams.get('state'), state);
    assert.ok(url.searchParams.get('nonce'));
    assert.equal(url.searchParams.has('code_challenge'), false);
  });

  test('uses the authorisation code flow once a client secret exists', async () => {
    process.env.GOOGLE_CLIENT_SECRET = 'configured-secret';
    try {
      const response = await app.inject({ method: 'POST', url: '/api/auth/oauth/google', payload: {} });
      assert.equal(response.statusCode, 200, response.body);
      const { url } = startResponse(response);
      assert.equal(url.searchParams.get('response_type'), 'code');
      assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
      assert.ok(url.searchParams.get('code_challenge'));
    } finally {
      delete process.env.GOOGLE_CLIENT_SECRET;
    }
  });

  test('sends a failed sign-in back to the app instead of showing a JSON error', async () => {
    const started = await app.inject({ method: 'POST', url: '/api/auth/oauth/google', payload: { redirectTo: '/dashboard' } });
    const { state, cookie } = startResponse(started);

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/oauth/google/callback',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
      payload: `id_token=not-a-real-token&state=${encodeURIComponent(state)}`
    });

    assert.equal(response.statusCode, 302);
    const location = new URL(response.headers.location);
    assert.equal(location.origin + location.pathname, `${publicUrl}/dashboard`);
    assert.equal(location.searchParams.get('auth_error'), 'Google sign-in could not be completed. Please try again.');
    assert.equal(response.body, '');
  });

  test('rejects a callback that does not carry the browser cookie', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/oauth/google/callback',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'id_token=not-a-real-token&state=guess'
    });

    assert.equal(response.statusCode, 302);
    const location = new URL(response.headers.location);
    assert.equal(location.pathname, '/');
    assert.equal(location.searchParams.get('auth_error'), 'Google sign-in did not match this browser. Please try again.');
  });

  test('reports a cancelled sign-in in plain language', async () => {
    const started = await app.inject({ method: 'POST', url: '/api/auth/oauth/google', payload: {} });
    const { state, cookie } = startResponse(started);

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/oauth/google/callback',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
      payload: `error=access_denied&state=${encodeURIComponent(state)}`
    });

    assert.equal(response.statusCode, 302);
    const location = new URL(response.headers.location);
    assert.equal(location.searchParams.get('auth_error'), 'Google sign-in was cancelled.');
  });
});
