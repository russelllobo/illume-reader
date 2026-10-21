import { createHash, randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { z } from 'zod';
import { pool, transaction } from './database.mjs';

const hash = token => createHash('sha256').update(token).digest('hex');
const publicUser = row => ({ id: row.id, email: row.email, role: row.role, created_at: row.created_at,
  last_sign_in_at: row.last_sign_in_at, user_metadata: row.user_metadata, app_metadata: row.app_metadata });
const credentials = z.object({ email: z.email().max(320), password: z.string().min(8).max(1024), native: z.boolean().optional() });
const cookieName = 'illume_session';
const cookie = token => `${cookieName}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${process.env.PUBLIC_URL?.startsWith('https:') ? '; Secure' : ''}`;
const attempts = new Map();
const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const appleKeys = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));

function sessionToken(request) {
  const authorization = request.headers.get('authorization');
  if (authorization?.startsWith('Bearer ') && authorization.length > 10) return authorization.slice(7);
  return request.headers.get('cookie')?.split(';').map(value => value.trim()).find(value => value.startsWith(cookieName + '='))?.slice(cookieName.length + 1) ?? '';
}

export async function initializeAuth() {
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users(lower(email)) WHERE email IS NOT NULL;
    CREATE TABLE IF NOT EXISTS oauth_attempts(state_hash text PRIMARY KEY,verifier text NOT NULL,nonce text NOT NULL,return_path text NOT NULL,expires_at timestamptz NOT NULL);
    CREATE INDEX IF NOT EXISTS auth_session_user_idx ON auth_sessions(user_id);`);
}

export async function getUser(request) {
  const token = sessionToken(request);
  if (!token) return null;
  const { rows } = await pool.query(`SELECT u.* FROM users u JOIN auth_sessions s ON s.user_id=u.id
    WHERE s.access_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now()
    AND (u.banned_until IS NULL OR u.banned_until<now())`, [hash(token)]);
  return rows[0] ? publicUser(rows[0]) : null;
}

export async function requireUser(request) {
  const user = await getUser(request);
  if (!user) throw Object.assign(new Error('Please sign in.'), { statusCode: 401 });
  return user;
}

export async function requireOwner(request) {
  const user = await requireUser(request);
  if (user.role !== 'owner') throw Object.assign(new Error('You do not have access to this operation.'), { statusCode: 403 });
  return user;
}

async function issueSession(user, native = false) {
  const access = randomBytes(32).toString('base64url');
  const refresh = randomBytes(48).toString('base64url');
  await pool.query(`INSERT INTO auth_sessions(id,user_id,access_hash,refresh_hash,expires_at,refresh_expires_at)
    VALUES($1,$2,$3,$4,now()+$5::interval,now()+interval '90 days')`,
  [randomUUID(), user.id, hash(access), hash(refresh), native ? '1 hour' : '30 days']);
  await pool.query('UPDATE users SET last_sign_in_at=now() WHERE id=$1', [user.id]);
  return { session: { user: publicUser(user), access_token: native ? access : '',
    ...(native ? { refresh_token: refresh, expires_in: 3600, token_type: 'bearer' } : {}) }, cookie: cookie(access) };
}

function json(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

export async function authHandler(request, operation, clientAddress = 'unknown') {
  if (operation === 'session') return json({ session: (await getUser(request)) ? { user: await getUser(request), access_token: '' } : null });
  if (operation === 'sign-out') {
    const token = sessionToken(request);
    if (token) await pool.query('UPDATE auth_sessions SET revoked_at=now() WHERE access_hash=$1', [hash(token)]);
    return json(null, 200, { 'Set-Cookie': `${cookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0` });
  }
  if (operation === 'refresh') {
    const body = await request.json().catch(() => ({}));
    if (!body.refresh_token) {
      const user = await requireUser(request);
      await pool.query("UPDATE auth_sessions SET expires_at=now()+interval '30 days' WHERE access_hash=$1 AND revoked_at IS NULL", [hash(sessionToken(request))]);
      return json({ session: { user, access_token: '' } }, 200, { 'Set-Cookie': cookie(sessionToken(request)) });
    }
    const refreshToken = z.string().min(32).max(256).parse(body.refresh_token);
    const result = await transaction(async db => {
      const { rows } = await db.query(`SELECT s.id AS session_id,u.* FROM auth_sessions s JOIN users u ON u.id=s.user_id
        WHERE s.refresh_hash=$1 AND s.revoked_at IS NULL AND s.refresh_expires_at>now()
        AND (u.banned_until IS NULL OR u.banned_until<now()) FOR UPDATE OF s`, [hash(refreshToken)]);
      if (!rows[0]) throw Object.assign(new Error('Your session expired. Please sign in again.'), { statusCode: 401 });
      const access = randomBytes(32).toString('base64url');
      await db.query("UPDATE auth_sessions SET access_hash=$1,expires_at=now()+interval '1 hour' WHERE id=$2", [hash(access), rows[0].session_id]);
      return { session: { user: publicUser(rows[0]), access_token: access, refresh_token: refreshToken, expires_in: 3600, token_type: 'bearer' } };
    });
    return json(result);
  }
  if (operation === 'id-token') {
    const body = z.object({ provider: z.enum(['apple', 'google']), token: z.string().max(20000), nonce: z.string().optional() }).parse(await request.json());
    const { payload } = await jwtVerify(body.token, body.provider === 'google' ? googleKeys : appleKeys,
      { issuer: body.provider === 'google' ? ['https://accounts.google.com', 'accounts.google.com'] : 'https://appleid.apple.com',
        audience: body.provider === 'google' ? process.env.GOOGLE_CLIENT_ID : process.env.APPLE_BUNDLE_ID || 'com.russellsystems.illume' });
    if (body.nonce && payload.nonce !== hash(body.nonce) && payload.nonce !== body.nonce) throw new Error('Invalid identity nonce');
    const user = await identityUser(body.provider, payload);
    const result = await issueSession(user, true);
    return json({ session: result.session });
  }
  if (!['sign-in', 'sign-up'].includes(operation)) throw Object.assign(new Error('Unknown authentication operation'), { statusCode: 404 });
  const now = Date.now();
  const recent = attempts.get(clientAddress) ?? { started: now, count: 0 };
  if (now - recent.started > 600000) { recent.started = now; recent.count = 0; }
  if (++recent.count > 30) throw Object.assign(new Error('Too many attempts. Please try again later.'), { statusCode: 429 });
  attempts.set(clientAddress, recent);
  if (attempts.size > 10000) for (const [key, value] of attempts) if (now - value.started > 600000) attempts.delete(key);
  const input = credentials.parse(await request.json());
  const email = input.email.trim().toLowerCase();
  const { rows } = await pool.query('SELECT * FROM users WHERE lower(email)=$1', [email]);
  let user = rows[0];
  if (operation === 'sign-up') {
    if (process.env.ALLOW_SIGNUP !== 'true') throw Object.assign(new Error('New account registration is temporarily unavailable during migration.'), { statusCode: 503 });
    if (user) throw Object.assign(new Error('An account with this email already exists. Please sign in.'), { statusCode: 409 });
    const passwordHash = await bcrypt.hash(input.password, 12);
    const created = await pool.query(`INSERT INTO users(id,email,password_hash,confirmed_at,user_metadata,app_metadata,role,source)
      VALUES($1,$2,$3,now(),'{}','{}','authenticated','{"local":true}'::jsonb) RETURNING *`, [randomUUID(), email, passwordHash]);
    user = created.rows[0];
  } else {
    const fallback = '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxD4CPiZeFe5pVLeWFAM/S.B8n6';
    const matches = await bcrypt.compare(input.password, user?.password_hash || fallback);
    if (!user || !matches || !user.confirmed_at || (user.banned_until && new Date(user.banned_until).getTime() > now)) throw Object.assign(new Error('Email or password is incorrect.'), { statusCode: 401 });
  }
  const result = await issueSession(user, input.native);
  return json({ session: result.session }, 200, input.native ? {} : { 'Set-Cookie': result.cookie });
}

async function identityUser(provider, payload) {
  if (!payload.sub) throw new Error('Identity provider did not return an account ID');
  const { rows } = await pool.query('SELECT u.* FROM identities i JOIN users u ON u.id=i.user_id WHERE i.provider=$1 AND i.subject=$2', [provider, payload.sub]);
  if (rows[0]) {
    if (rows[0].banned_until && new Date(rows[0].banned_until).getTime() > Date.now()) throw new Error('Account unavailable');
    return rows[0];
  }
  const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : null;
  if (!email || (payload.email_verified !== true && payload.email_verified !== 'true')) throw new Error('A verified email is required to create an account');
  if (process.env.ALLOW_SIGNUP !== 'true') throw new Error('New account registration is temporarily unavailable during migration.');
  return transaction(async db => {
    const existing = await db.query('SELECT id FROM users WHERE lower(email)=$1', [email]);
    if (existing.rows.length) throw new Error('Please sign in to your existing account before linking another sign-in provider.');
    const result = await db.query(`INSERT INTO users(id,email,confirmed_at,user_metadata,app_metadata,role,source)
      VALUES($1,$2,now(),$3,$4,'authenticated','{"local":true}') RETURNING *`,
    [randomUUID(), email, JSON.stringify({ full_name: payload.name || '', avatar_url: payload.picture || '' }), JSON.stringify({ provider })]);
    await db.query('INSERT INTO identities(provider,subject,user_id,source) VALUES($1,$2,$3,$4)', [provider, payload.sub, result.rows[0].id, JSON.stringify(payload)]);
    return result.rows[0];
  });
}

export async function googleOAuth(request, callback = false) {
  const publicUrl = process.env.PUBLIC_URL;
  if (!publicUrl || !process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) throw new Error('Google sign-in is not configured');
  const redirectUri = `${publicUrl}/api/auth/oauth/google/callback`;
  if (!callback) {
    const state = randomBytes(32).toString('base64url');
    const verifier = randomBytes(48).toString('base64url');
    const nonce = randomBytes(32).toString('base64url');
    const body = await request.json().catch(() => ({}));
    const supplied = typeof body.redirectTo === 'string' ? new URL(body.redirectTo, publicUrl) : new URL('/', publicUrl);
    if (supplied.origin !== new URL(publicUrl).origin) throw new Error('Invalid return address');
    await pool.query("INSERT INTO oauth_attempts(state_hash,verifier,nonce,return_path,expires_at) VALUES($1,$2,$3,$4,now()+interval '10 minutes')", [hash(state), verifier, nonce, supplied.pathname + supplied.search]);
    const params = new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: redirectUri, response_type: 'code', scope: 'openid email profile', state, nonce,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
    return json({ url: 'https://accounts.google.com/o/oauth2/v2/auth?' + params }, 200,
      { 'Set-Cookie': `illume_oauth=${state}; HttpOnly; SameSite=Lax; Path=/api/auth/oauth; Max-Age=600${publicUrl.startsWith('https:') ? '; Secure' : ''}` });
  }
  const url = new URL(request.url);
  const state = url.searchParams.get('state') || '';
  const browserState = request.headers.get('cookie')?.split(';').map(value => value.trim()).find(value => value.startsWith('illume_oauth='))?.slice(13);
  if (!state || state !== browserState) throw new Error('Google sign-in state did not match this browser');
  const attempt = await pool.query('DELETE FROM oauth_attempts WHERE state_hash=$1 AND expires_at>now() RETURNING *', [hash(state)]);
  if (!attempt.rows[0]) throw new Error('Google sign-in expired. Please try again.');
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ code: url.searchParams.get('code') || '', client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: attempt.rows[0].verifier }) });
  const tokens = await response.json();
  if (!response.ok || typeof tokens.id_token !== 'string') throw new Error('Google sign-in could not be completed');
  const { payload } = await jwtVerify(tokens.id_token, googleKeys, { issuer: ['https://accounts.google.com', 'accounts.google.com'], audience: process.env.GOOGLE_CLIENT_ID });
  if (payload.nonce !== attempt.rows[0].nonce) throw new Error('Google identity nonce did not match');
  const user = await identityUser('google', payload);
  const result = await issueSession(user);
  return new Response(null, { status: 302, headers: { Location: publicUrl + attempt.rows[0].return_path, 'Set-Cookie': result.cookie, 'Cache-Control': 'no-store' } });
}
