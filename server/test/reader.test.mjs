import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { buildApp } from '../app.mjs';
import { pool } from '../database.mjs';

const password = `rehearsal-${randomBytes(8).toString('hex')}`;
const users = [];
let app;

function cookieFrom(response) {
  const raw = response.headers['set-cookie'];
  const header = Array.isArray(raw) ? raw.join(';') : String(raw ?? '');
  const match = header.match(/illume_session=([^;]+)/);
  assert.ok(match, 'session cookie was set');
  return `illume_session=${match[1]}`;
}

async function createUser(label) {
  const email = `${label}-${randomUUID()}@invalid.illume`;
  const hash = await bcrypt.hash(password, 4);
  const { rows } = await pool.query(
    `INSERT INTO users(id,email,password_hash,confirmed_at,role) VALUES($1,$2,$3,now(),'authenticated') RETURNING id,email`,
    [randomUUID(), email, hash]
  );
  users.push(rows[0]);
  return rows[0];
}

async function signIn(email) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-in',
    headers: { 'content-type': 'application/json' },
    payload: { email, password }
  });
  assert.equal(response.statusCode, 200, response.body);
  return cookieFrom(response);
}

function multipart(metadata, filename, bytes, type) {
  const boundary = '----illume-test';
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n${JSON.stringify(metadata)}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ]);
  return { body, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

describe('local reader', { concurrency: 1 }, () => {
  before(async () => {
    app = await buildApp();
  });

  after(async () => {
    for (const user of users) {
      await pool.query('DELETE FROM jobs WHERE payload->>\'userId\'=$1', [user.id]);
      await pool.query('DELETE FROM object_files WHERE user_id=$1', [user.id]);
      await pool.query('DELETE FROM users WHERE id=$1', [user.id]);
    }
    await app.close();
    await pool.end();
  });

  test('signs in, isolates libraries, and round-trips a book', async () => {
    const owner = await createUser('owner');
    const other = await createUser('other');
    const ownerCookie = await signIn(owner.email);
    const otherCookie = await signIn(other.email);
    const epub = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('section-one')]);
    const upload = multipart({
      title: 'Local rehearsal',
      author: 'Test',
      document_type: 'epub',
      file_name: 'local.epub',
      paragraph_count: 1,
      chapter_count: 1
    }, 'local.epub', epub, 'application/epub+zip');
    const created = await app.inject({ method: 'POST', url: '/api/library', headers: { ...upload.headers, cookie: ownerCookie }, payload: upload.body });
    assert.equal(created.statusCode, 200, created.body);
    const book = created.json().book;
    assert.equal(book.user_id, owner.id);
    assert.equal(book.title, 'Local rehearsal');
    assert.equal(Number(book.file_size), epub.length);

    const ownerList = await app.inject({ method: 'GET', url: '/api/library', headers: { cookie: ownerCookie } });
    assert.equal(ownerList.json().books.some(item => item.id === book.id), true);
    const otherList = await app.inject({ method: 'GET', url: '/api/library', headers: { cookie: otherCookie } });
    assert.equal(otherList.json().books.some(item => item.id === book.id), false);

    const denied = await app.inject({ method: 'GET', url: `/api/library/${book.id}/file`, headers: { cookie: otherCookie } });
    assert.equal(denied.statusCode, 404);
    const rawDenied = await app.inject({ method: 'GET', url: `/api/files/epubs/${book.storage_path}`, headers: { cookie: otherCookie } });
    assert.equal(rawDenied.statusCode, 403);
    const downloaded = await app.inject({ method: 'GET', url: `/api/library/${book.id}/file`, headers: { cookie: ownerCookie } });
    assert.equal(downloaded.statusCode, 200);
    assert.equal(Buffer.compare(downloaded.rawPayload, epub), 0);

    const progress = await app.inject({
      method: 'PATCH',
      url: `/api/library/${book.id}`,
      headers: { cookie: ownerCookie, 'content-type': 'application/json' },
      payload: { current_index: 4, current_page: 2 }
    });
    assert.equal(progress.statusCode, 200, progress.body);
    assert.equal(progress.json().book.current_index, 4);
    const otherProgress = await app.inject({
      method: 'PATCH',
      url: `/api/library/${book.id}`,
      headers: { cookie: otherCookie, 'content-type': 'application/json' },
      payload: { title: 'Stolen' }
    });
    assert.equal(otherProgress.statusCode, 404);

    const removed = await app.inject({ method: 'DELETE', url: `/api/library/${book.id}`, headers: { cookie: ownerCookie } });
    assert.equal(removed.statusCode, 204);
    const afterDelete = await app.inject({ method: 'GET', url: '/api/library', headers: { cookie: ownerCookie } });
    assert.equal(afterDelete.json().books.some(item => item.id === book.id), false);
  });

  test('rejects the second concurrent upload once the quota is full', async () => {
    const user = await createUser('quota');
    const cookie = await signIn(user.email);
    const quota = Number(process.env.FREE_STORAGE_QUOTA_BYTES || 104_857_600);
    await pool.query(
      'INSERT INTO object_files(bucket,path,user_id,size,mime_type,sha256) VALUES($1,$2,$3,$4,$5,$6)',
      ['epubs', `${user.id}/quota-placeholder`, user.id, quota - 40, 'application/epub+zip', 'placeholder']
    );
    const bytes = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(26, 1)]);
    const send = () => {
      const upload = multipart({ document_type: 'epub', file_name: 'quota.epub', title: 'Quota' }, 'quota.epub', bytes, 'application/epub+zip');
      return app.inject({ method: 'POST', url: '/api/library', headers: { ...upload.headers, cookie }, payload: upload.body });
    };
    const results = await Promise.all([send(), send()]);
    const statuses = results.map(result => result.statusCode).sort();
    assert.deepEqual(statuses, [200, 413]);
  });

  test('reads an imported book with the same bytes as the export record', async () => {
    const { rows } = await pool.query(`
      SELECT b.id, b.user_id, o.sha256, o.size
      FROM books b
      JOIN object_files o ON o.bucket='epubs' AND o.path=b.storage_path
      WHERE b.document_type='epub'
      ORDER BY o.size ASC
      LIMIT 1`);
    assert.ok(rows[0], 'imported epub exists');
    const token = randomBytes(32).toString('base64url');
    const accessHash = createHash('sha256').update(token).digest('hex');
    await pool.query(
      `INSERT INTO auth_sessions(id,user_id,access_hash,expires_at,refresh_expires_at)
       VALUES($1,$2,$3,now()+interval '10 minutes',now()+interval '10 minutes')`,
      [randomUUID(), rows[0].user_id, accessHash]
    );
    try {
      const response = await app.inject({
        method: 'GET',
        url: `/api/library/${rows[0].id}/file`,
        headers: { cookie: `illume_session=${token}` }
      });
      assert.equal(response.statusCode, 200);
      assert.equal(response.rawPayload.length, Number(rows[0].size));
      assert.equal(createHash('sha256').update(response.rawPayload).digest('hex'), rows[0].sha256);
    } finally {
      await pool.query('DELETE FROM auth_sessions WHERE access_hash=$1', [accessHash]);
    }
  });

  test('rejects an incorrect password for an imported account', async () => {
    const { rows } = await pool.query(`SELECT email FROM users WHERE password_hash IS NOT NULL AND email IS NOT NULL LIMIT 1`);
    assert.ok(rows[0]);
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in',
      headers: { 'content-type': 'application/json' },
      payload: { email: rows[0].email, password: 'incorrect-password' }
    });
    assert.equal(response.statusCode, 401);
    assert.equal(response.json().message, 'Email or password is incorrect.');
    assert.equal(JSON.stringify(response.json()).includes('password_hash'), false);
  });
});
