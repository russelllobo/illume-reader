import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { ZodError } from 'zod';
import { authHandler, getUser, googleOAuth, initializeAuth, requireUser } from './auth.mjs';
import { pool } from './database.mjs';
import {
  accountSummary, bookFile, createBook, deleteBook, enqueueDocumentProcessing, listBooks, listPages, updateBook
} from './library.mjs';
import { contentTypeFor, filePath, validFileGrant } from './storage.mjs';
import { generateReaderImage } from './images.mjs';
import { narrate } from './narration.mjs';
import {
  appleNotifications, createBillingPortal, createCheckoutSession, deleteAccount, stripeWebhook,
  syncAppleSubscription
} from './billing.mjs';
import { processDocument, readerDashboard } from './content.mjs';
import {
  instagramFeed, instagramTokenExchange, reelsPost, tiktokFeed, tiktokTokenExchange,
  youtubeAnalytics, youtubeFeed, youtubeTokenExchange
} from './social.mjs';

const serverRoot = join(fileURLToPath(import.meta.url), '..');
const staticRoot = process.env.STATIC_ROOT || join(serverRoot, '..', 'dist');

const staticMime = new Map(Object.entries({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2'
}));

function webRequest(request, rawBody) {
  const url = new URL(request.url, process.env.PUBLIC_URL || 'http://127.0.0.1');
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value == null) continue;
    headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }
  const method = request.method;
  const hasBody = !['GET', 'HEAD'].includes(method) && (rawBody != null || request.body != null);
  const body = rawBody != null
    ? (typeof rawBody === 'string' ? rawBody : Buffer.from(rawBody))
    : JSON.stringify(request.body);
  return new Request(url, { method, headers, body: hasBody ? body : undefined });
}

async function sendResponse(reply, response) {
  reply.code(response.status);
  const cookies = response.headers.getSetCookie?.() ?? [];
  if (cookies.length) reply.header('set-cookie', cookies);
  response.headers.forEach((value, key) => {
    if (key !== 'set-cookie') reply.header(key, value);
  });
  if (response.status === 204 || response.status === 302) return reply.send();
  const bytes = Buffer.from(await response.arrayBuffer());
  return reply.send(bytes);
}

function failure(error) {
  if (error instanceof ZodError) return { statusCode: 400, message: 'Some of the submitted information is invalid.' };
  if (error.code === '23505') return { statusCode: 409, message: 'That record already exists.' };
  if (error.code === '23514') return { statusCode: 400, message: 'That change is not allowed.' };
  const statusCode = error.statusCode || 500;
  return { statusCode, message: statusCode >= 500 ? 'Something went wrong.' : error.message };
}

export async function buildApp() {
  await initializeAuth();
  const app = Fastify({ logger: false, bodyLimit: 2_000_000, trustProxy: process.env.TRUST_PROXY === '1' });
  await app.register(multipart, { limits: { fileSize: 5_368_709_120, files: 1, fields: 4 } });
  // Preserve the exact request bytes so the Stripe webhook can verify its signature.
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (request, body, done) => {
    request.rawBody = body;
    try {
      done(null, body.length ? JSON.parse(body.toString('utf8')) : undefined);
    } catch (error) {
      done(Object.assign(new Error('Request body is invalid.'), { statusCode: 400 }));
    }
  });
  app.setErrorHandler((error, request, reply) => {
    const mapped = failure(error);
    if (mapped.statusCode >= 500) console.error(error);
    reply.code(mapped.statusCode).send({ message: mapped.message });
  });

  app.get('/api/health', async () => {
    await pool.query('SELECT 1');
    return { ok: true };
  });

  const authRoute = operation => async (request, reply) => {
    const response = await authHandler(webRequest(request), operation, request.ip);
    return sendResponse(reply, response);
  };
  app.get('/api/auth/session', authRoute('session'));
  app.post('/api/auth/sign-in', authRoute('sign-in'));
  app.post('/api/auth/sign-up', authRoute('sign-up'));
  app.post('/api/auth/sign-out', authRoute('sign-out'));
  app.post('/api/auth/refresh', authRoute('refresh'));
  app.post('/api/auth/id-token', authRoute('id-token'));
  app.post('/api/auth/oauth/google', async (request, reply) => sendResponse(reply, await googleOAuth(webRequest(request), false)));
  app.get('/api/auth/oauth/google/callback', async (request, reply) => sendResponse(reply, await googleOAuth(webRequest(request), true)));

  app.get('/api/account/summary', async request => accountSummary((await requireUser(webRequest(request))).id));
  app.get('/api/library', async request => ({ books: await listBooks((await requireUser(webRequest(request))).id) }));
  app.patch('/api/library/:id', async request => ({ book: await updateBook((await requireUser(webRequest(request))).id, request.params.id, request.body ?? {}) }));
  app.delete('/api/library/:id', async (request, reply) => {
    await deleteBook((await requireUser(webRequest(request))).id, request.params.id);
    return reply.code(204).send();
  });
  app.get('/api/library/:id/pages', async request => ({ pages: await listPages((await requireUser(webRequest(request))).id, request.params.id) }));
  app.post('/api/library/:id/process', async request => ({ book: await enqueueDocumentProcessing((await requireUser(webRequest(request))).id, request.params.id) }));
  app.get('/api/library/:id/file', async (request, reply) => {
    const file = await bookFile((await requireUser(webRequest(request))).id, request.params.id);
    const metadata = await stat(file.destination);
    reply.header('content-type', file.mimeType);
    reply.header('content-length', metadata.size);
    reply.header('content-disposition', `inline; filename="${file.filename}"`);
    reply.header('cache-control', 'private, no-store');
    reply.header('x-content-type-options', 'nosniff');
    return reply.send(createReadStream(file.destination));
  });
  app.post('/api/library', async request => {
    const user = await requireUser(webRequest(request));
    const file = await request.file();
    if (!file) throw Object.assign(new Error('Choose a file to upload.'), { statusCode: 400 });
    const metadataField = file.fields?.metadata;
    const raw = Array.isArray(metadataField) ? metadataField[0]?.value : metadataField?.value;
    let metadata = {};
    try { metadata = JSON.parse(raw || '{}'); }
    catch { throw Object.assign(new Error('Upload details are invalid.'), { statusCode: 400 }); }
    return { book: await createBook(user.id, metadata, file.file) };
  });

  app.get('/api/files/:bucket/*', async (request, reply) => {
    const bucket = request.params.bucket;
    const key = request.params['*'];
    const granted = validFileGrant(bucket, key, request.query.expires, request.query.signature);
    if (!granted) {
      const user = await getUser(webRequest(request));
      if (!user) throw Object.assign(new Error('Please sign in.'), { statusCode: 401 });
      if (!key.startsWith(`${user.id}/`)) throw Object.assign(new Error('You can only access your own files.'), { statusCode: 403 });
    }
    const destination = await filePath(bucket, key);
    const metadata = await stat(destination);
    reply.header('content-type', contentTypeFor(key));
    reply.header('content-length', metadata.size);
    reply.header('cache-control', bucket === 'reader-images' ? 'private, max-age=31536000, immutable' : 'private, max-age=60');
    reply.header('x-content-type-options', 'nosniff');
    return reply.send(createReadStream(destination));
  });

  const actions = {
    'apple-app-store-notifications': appleNotifications,
    'create-billing-portal': createBillingPortal,
    'create-checkout-session': createCheckoutSession,
    'delete-account': deleteAccount,
    'edge-tts': narrate,
    'generate-reader-image': generateReaderImage,
    'instagram-feed': instagramFeed,
    'instagram-token-exchange': instagramTokenExchange,
    'process-reader-document': processDocument,
    'reader-dashboard': readerDashboard,
    'reels-post': reelsPost,
    'stripe-webhook': stripeWebhook,
    'sync-apple-subscription': syncAppleSubscription,
    'tiktok-feed': tiktokFeed,
    'tiktok-token-exchange': tiktokTokenExchange,
    'youtube-analytics': youtubeAnalytics,
    'youtube-feed': youtubeFeed,
    'youtube-token-exchange': youtubeTokenExchange
  };
  const rawBodyActions = new Set(['stripe-webhook', 'apple-app-store-notifications']);
  app.all('/api/actions/:name', async (request, reply) => {
    const action = actions[request.params.name];
    if (!action) return reply.code(404).send({ error: 'This operation is not available on the local server yet.' });
    if (request.method === 'OPTIONS') return reply.code(204).header('cache-control', 'no-store').send();
    if (!['GET', 'POST'].includes(request.method)) return reply.code(405).send({ error: 'Method not allowed' });
    const raw = rawBodyActions.has(request.params.name) ? request.rawBody : undefined;
    return sendResponse(reply, await action(webRequest(request, raw)));
  });

  // Serve the built web app alongside the API. Hashed assets are immutable;
  // everything else falls back to index.html for client-side routes.
  app.get('/*', async (request, reply) => {
    const pathname = normalize('/' + (request.params['*'] || '')).replace(/^\/+/, '');
    const candidate = normalize(join(staticRoot, pathname));
    if (candidate !== staticRoot && !candidate.startsWith(staticRoot + sep)) {
      return reply.code(403).send({ message: 'Not found.' });
    }
    let destination = candidate;
    let immutable = false;
    try {
      const metadata = await stat(destination);
      if (metadata.isDirectory()) destination = join(destination, 'index.html');
      else if (pathname.startsWith('assets/')) immutable = true;
    } catch {
      destination = join(staticRoot, 'index.html');
    }
    let metadata;
    try {
      metadata = await stat(destination);
    } catch {
      return reply.code(404).send({ message: 'Not found.' });
    }
    const type = staticMime.get(extname(destination).toLowerCase());
    if (!type) return reply.code(403).send({ message: 'Not found.' });
    reply.header('content-type', type);
    reply.header('content-length', metadata.size);
    reply.header('cache-control', immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=60');
    reply.header('x-content-type-options', 'nosniff');
    return reply.send(createReadStream(destination));
  });

  return app;
}

if (process.argv[1] && process.argv[1].endsWith('app.mjs')) {
  const app = await buildApp();
  await app.listen({ host: process.env.HOST || '127.0.0.1', port: Number(process.env.PORT || 8787) });
  console.log(`Illume server listening on ${process.env.HOST || '127.0.0.1'}:${process.env.PORT || 8787}`);
}
