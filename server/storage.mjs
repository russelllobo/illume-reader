import { createHmac, createHash, timingSafeEqual, randomUUID } from 'node:crypto';
import { mkdir, lstat, open, rename, unlink, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pool } from './database.mjs';

const buckets = new Set(['epubs', 'reader-images', 'reels']);
const root = path.resolve(process.env.FILES_ROOT || '');
if (!process.env.FILES_ROOT || !process.env.SESSION_SECRET) throw new Error('FILES_ROOT and SESSION_SECRET are required');
const mimeFor = name => ({ '.epub': 'application/epub+zip', '.pdf': 'application/pdf', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.mp4': 'video/mp4' })[path.extname(name)] || 'application/octet-stream';

export async function filePath(bucket, key, allowMissing = false) {
  if (!buckets.has(bucket) || typeof key !== 'string' || !key || key.startsWith('/') || key.includes('\\') || key.includes('\0')) throw new Error('Invalid file path');
  const parts = key.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) throw new Error('Invalid file path');
  const destination = path.resolve(root, bucket, ...parts);
  if (!destination.startsWith(root + path.sep)) throw new Error('Invalid file path');
  let current = root;
  for (const part of [bucket, ...parts]) {
    current = path.join(current, part);
    try {
      const entry = await lstat(current);
      if (entry.isSymbolicLink()) throw new Error('Symbolic links are not permitted in file storage');
    } catch (error) {
      if (error.code !== 'ENOENT' || !allowMissing) throw error;
    }
  }
  return destination;
}

function signature(bucket, key, expires) {
  return createHmac('sha256', process.env.SESSION_SECRET).update(JSON.stringify([bucket, key, expires])).digest('base64url');
}

export function signedFileUrl(bucket, key, lifetime = 3600) {
  const expires = String(Math.floor(Date.now() / 1000) + Math.min(lifetime, 86400));
  const encoded = key.split('/').map(encodeURIComponent).join('/');
  return `${process.env.PUBLIC_URL}/api/files/${bucket}/${encoded}?expires=${expires}&signature=${signature(bucket, key, expires)}`;
}

export async function stageObject(bucket, key, source, { maxBytes, sniff }) {
  const destination = await filePath(bucket, key, true);
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = `${destination}.${randomUUID()}.partial`;
  const hasher = createHash('sha256');
  let size = 0;
  let sniffed = false;
  const handle = await open(temporary, 'wx', 0o600);
  try {
    for await (const chunk of source) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (!buffer.length) continue;
      if (!sniffed) {
        sniff?.(buffer);
        sniffed = true;
      }
      size += buffer.length;
      if (size > maxBytes) throw Object.assign(new Error('File exceeds the maximum size'), { statusCode: 413 });
      hasher.update(buffer);
      await handle.write(buffer);
    }
    if (!sniffed) throw Object.assign(new Error('The file is empty.'), { statusCode: 400 });
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => {});
    await unlink(temporary).catch(() => {});
    throw error;
  }
  await handle.close();
  return { temporary, destination, size, sha256: hasher.digest('hex') };
}

export async function commitStaged(staged) {
  await rename(staged.temporary, staged.destination);
}

export async function discardStaged(staged) {
  if (staged?.temporary) await unlink(staged.temporary).catch(() => {});
}

export function contentTypeFor(name) {
  return mimeFor(name);
}

export function validFileGrant(bucket, key, expires, supplied) {
  if (!expires || !supplied || !/^\d+$/.test(expires) || Number(expires) < Date.now() / 1000 || Number(expires) > Date.now() / 1000 + 86401) return false;
  const expected = Buffer.from(signature(bucket, key, expires));
  const actual = Buffer.from(supplied);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function adapter(userInput, admin = false) {
  async function authorize(bucket, key) {
    if (!buckets.has(bucket)) throw new Error('Unknown file collection');
    if (admin) return null;
    const user = await (typeof userInput === 'function' ? userInput() : userInput);
    if (!user || !key.startsWith(user.id + '/')) throw new Error('You can only access your own files');
    return user;
  }
  const result = async operation => {
    try { return { data: await operation(), error: null }; }
    catch (error) { return { data: null, error }; }
  };
  return { from(bucket) {
    return {
      download: key => result(async () => {
        await authorize(bucket, key);
        const destination = await filePath(bucket, key);
        const metadata = await pool.query('SELECT mime_type FROM object_files WHERE bucket=$1 AND path=$2', [bucket, key]);
        return new Blob([await readFile(destination)], { type: metadata.rows[0]?.mime_type || mimeFor(key) });
      }),
      upload: (key, input, options = {}) => result(async () => {
        const user = await authorize(bucket, key);
        const bytes = input instanceof Blob ? Buffer.from(await input.arrayBuffer()) : Buffer.from(input);
        const limit = bucket === 'reader-images' ? 10485760 : bucket === 'reels' ? 52428800 : 5368709120;
        if (bytes.length > limit) throw new Error('File exceeds the maximum size');
        const destination = await filePath(bucket, key, true);
        await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
        const exists = await lstat(destination).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
        if (exists && !options.upsert) throw new Error('This file already exists');
        const temporary = destination + '.' + randomUUID() + '.partial';
        const handle = await open(temporary, 'wx', 0o600);
        try { await handle.writeFile(bytes); await handle.sync(); }
        finally { await handle.close(); }
        try {
          await rename(temporary, destination);
          const ownerId = user?.id || (/^[0-9a-f-]{36}\//i.test(key) ? key.split('/')[0] : null);
          await pool.query(`INSERT INTO object_files(bucket,path,user_id,size,mime_type,sha256) VALUES($1,$2,$3,$4,$5,$6)
            ON CONFLICT(bucket,path) DO UPDATE SET size=excluded.size,mime_type=excluded.mime_type,sha256=excluded.sha256`,
          [bucket, key, ownerId, bytes.length, options.contentType || mimeFor(key), createHash('sha256').update(bytes).digest('hex')]);
        } catch (error) { await unlink(temporary).catch(() => {}); throw error; }
        return { path: key };
      }),
      remove: keys => result(async () => {
        const removed = [];
        for (const key of keys) {
          await authorize(bucket, key);
          const destination = await filePath(bucket, key, true);
          await unlink(destination).catch(error => { if (error.code !== 'ENOENT') throw error; });
          await pool.query('DELETE FROM object_files WHERE bucket=$1 AND path=$2', [bucket, key]);
          removed.push({ name: key });
        }
        return removed;
      }),
      list: (folder, options = {}) => result(async () => {
        if (!admin) await authorize(bucket, folder + '/');
        const destination = folder ? await filePath(bucket, folder) : path.join(root, bucket);
        const entries = await readdir(destination, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
        const result = [];
        for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name)).slice(options.offset || 0, (options.offset || 0) + (options.limit || 1000))) {
          if (entry.isSymbolicLink()) continue;
          const metadata = await lstat(path.join(destination, entry.name));
          result.push({ name: entry.name, created_at: metadata.birthtime.toISOString(), updated_at: metadata.mtime.toISOString(),
            metadata: entry.isFile() ? { size: metadata.size, mimetype: mimeFor(entry.name) } : null });
        }
        return result;
      }),
      createSignedUrls: (keys, seconds) => result(async () => {
        const results = [];
        for (const key of keys) { await authorize(bucket, key); await filePath(bucket, key); results.push({ path: key, signedUrl: signedFileUrl(bucket, key, seconds) }); }
        return results;
      }),
      getPublicUrl: key => ({ data: { publicUrl: bucket === 'reels' ? signedFileUrl(bucket, key, 86400) : '' } })
    };
  } };
}

export const storageFor = user => adapter(user);
export const adminStorage = adapter(null, true);
