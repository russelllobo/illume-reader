import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../app.mjs';
import { pool } from '../database.mjs';

let app;
let session;

describe('cached reader images', { concurrency: 1 }, () => {
  before(async () => {
    app = await buildApp();
    const { rows } = await pool.query(`
      SELECT ri.user_id, ri.book_id, ri.start_word, ri.end_word, ri.style, ri.storage_path, o.size
      FROM reader_images ri
      JOIN object_files o ON o.bucket='reader-images' AND o.path=ri.storage_path
      ORDER BY o.size DESC
      LIMIT 1`);
    assert.ok(rows[0], 'imported reader image exists');
    session = rows[0];
    const token = randomBytes(32).toString('base64url');
    session.token = token;
    session.accessHash = createHash('sha256').update(token).digest('hex');
    await pool.query(
      `INSERT INTO auth_sessions(id,user_id,access_hash,expires_at,refresh_expires_at)
       VALUES($1,$2,$3,now()+interval '10 minutes',now()+interval '10 minutes')`,
      [randomUUID(), session.user_id, session.accessHash]
    );
  });

  after(async () => {
    if (session) await pool.query('DELETE FROM auth_sessions WHERE access_hash=$1', [session.accessHash]);
    await app.close();
    await pool.end();
  });

  test('returns a short cached address instead of the image bytes', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/actions/generate-reader-image',
      headers: { cookie: `illume_session=${session.token}`, 'content-type': 'application/json' },
      payload: {
        bookId: session.book_id,
        bookTitle: 'Cached book',
        endWord: session.end_word,
        imageStyle: session.style,
        startWord: session.start_word,
        text: 'A short section that already has a saved illustration.'
      }
    });
    assert.equal(response.statusCode, 200, response.body);
    const body = response.json();
    assert.equal(body.cached, true);
    assert.equal(body.imageUrl.startsWith('/api/files/reader-images/'), true);
    assert.ok(response.rawPayload.length < 2000);
    assert.ok(response.rawPayload.length < Number(session.size));

    const file = await app.inject({
      method: 'GET',
      url: body.imageUrl,
      headers: { cookie: `illume_session=${session.token}` }
    });
    assert.equal(file.statusCode, 200, file.body.slice(0, 200));
    assert.equal(file.headers['cache-control'], 'private, max-age=31536000, immutable');
    assert.equal(file.rawPayload.length, Number(session.size));

    const stranger = randomBytes(32).toString('base64url');
    const denied = await app.inject({ method: 'GET', url: body.imageUrl, headers: { cookie: `illume_session=${stranger}` } });
    assert.equal(denied.statusCode, 401);
  });
});
