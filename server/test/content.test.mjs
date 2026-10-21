import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { pool } from '../database.mjs';
import { createBook, deleteBook } from '../library.mjs';
import { processDocument, readerDashboard } from '../content.mjs';

const password = `content-${randomBytes(8).toString('hex')}`;
const createdUsers = [];
const createdSessions = [];

function minimalPdf(text) {
  const enc = value => Buffer.from(value, 'latin1');
  const stream = `BT /F1 24 Tf 100 700 Td (${text}) Tj ET`;
  const objects = [
    null,
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${enc(stream).length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  let out = '%PDF-1.4\n';
  const offsets = [0];
  for (let index = 1; index <= 5; index += 1) {
    offsets[index] = enc(out).length;
    out += `${index} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefAt = enc(out).length;
  out += 'xref\n0 6\n0000000000 65535 f \n';
  for (let index = 1; index <= 5; index += 1) out += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`;
  return Buffer.from(enc(out));
}

async function createUser(label) {
  const email = `${label}-${randomUUID()}@invalid.illume`;
  const hash = await bcrypt.hash(password, 4);
  const { rows } = await pool.query(
    `INSERT INTO users(id,email,password_hash,confirmed_at,role) VALUES($1,$2,$3,now(),'authenticated') RETURNING id,email`,
    [randomUUID(), email, hash]
  );
  createdUsers.push(rows[0]);
  return rows[0];
}

async function startSession(userId) {
  const token = randomBytes(32).toString('base64url');
  const accessHash = createHash('sha256').update(token).digest('hex');
  await pool.query(
    `INSERT INTO auth_sessions(id,user_id,access_hash,expires_at,refresh_expires_at)
     VALUES($1,$2,$3,now()+interval '1 hour',now()+interval '1 hour')`,
    [randomUUID(), userId, accessHash]
  );
  createdSessions.push(accessHash);
  return token;
}

const get = token => new Request('http://localhost/api/actions/reader-dashboard', {
  method: 'GET',
  headers: token ? { cookie: `illume_session=${token}` } : {}
});

const postProcess = (token, body) => new Request('http://localhost/api/actions/process-reader-document', {
  method: 'POST',
  headers: { ...(token ? { cookie: `illume_session=${token}` } : {}), 'content-type': 'application/json' },
  body: JSON.stringify(body)
});

describe('owner dashboard and document pipeline', { concurrency: 1 }, () => {
  before(async () => {
    const { rows } = await pool.query(`SELECT id FROM users WHERE lower(email)=lower('r.lobo2003@gmail.com')`);
    assert.ok(rows[0], 'owner account exists in rehearsal data');
  });

  after(async () => {
    if (createdSessions.length) {
      await pool.query('DELETE FROM auth_sessions WHERE access_hash = ANY($1)', [createdSessions]);
    }
    for (const user of createdUsers) {
      await pool.query(`DELETE FROM jobs WHERE payload->>'bookId' IN (SELECT id::text FROM books WHERE user_id=$1)`, [user.id]);
      await pool.query(`DELETE FROM jobs WHERE payload->>'userId'=$1`, [user.id]);
      await pool.query('DELETE FROM object_files WHERE user_id=$1', [user.id]);
      await pool.query('DELETE FROM users WHERE id=$1', [user.id]);
    }
    await pool.end();
  });

  test('dashboard rejects unauthenticated callers', async () => {
    const response = await readerDashboard(get(null));
    assert.equal(response.status, 401);
    assert.match((await response.json()).error, /sign in/i);
  });

  test('dashboard rejects non-owners', async () => {
    const user = await createUser('dashboard-denied');
    const token = await startSession(user.id);
    const response = await readerDashboard(get(token));
    assert.equal(response.status, 403);
    assert.match((await response.json()).error, /owner/i);
  });

  test('dashboard returns aggregates for the owner', async () => {
    const { rows } = await pool.query(`SELECT id FROM users WHERE lower(email)=lower('r.lobo2003@gmail.com')`);
    const token = randomBytes(32).toString('base64url');
    const accessHash = createHash('sha256').update(token).digest('hex');
    await pool.query(
      `INSERT INTO auth_sessions(id,user_id,access_hash,expires_at,refresh_expires_at)
       VALUES($1,$2,$3,now()+interval '10 minutes',now()+interval '10 minutes')`,
      [randomUUID(), rows[0].id, accessHash]
    );
    try {
      const response = await readerDashboard(get(token));
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.ok(body.generatedAt);
      assert.ok(Number.isInteger(body.totals.users) && body.totals.users >= 1);
      assert.ok(Number.isInteger(body.totals.books));
      assert.ok(Number.isInteger(body.totals.imagesGenerated));
      assert.ok(body.storage.totalBytes >= body.storage.booksBytes + body.storage.imagesBytes);
      assert.ok(Array.isArray(body.timeline));
      assert.ok(Array.isArray(body.users) && body.users.length === body.totals.users);
      assert.ok(Array.isArray(body.waitlist));
      const owner = body.users.find(entry => String(entry.email).toLowerCase() === 'r.lobo2003@gmail.com');
      assert.ok(owner, 'owner appears in per-user breakdown');
      assert.ok(Array.isArray(owner.journey) && Array.isArray(owner.timeline) && Array.isArray(owner.books));
    } finally {
      await pool.query('DELETE FROM auth_sessions WHERE access_hash=$1', [accessHash]);
    }
  });

  test('document job extracts text from a PDF into pages', async () => {
    const user = await createUser('pdf-worker');
    const token = await startSession(user.id);
    const bytes = minimalPdf('Hello world');
    const book = await createBook(user.id, { document_type: 'pdf', file_name: 'hello.pdf', title: 'Hello PDF' }, Readable.from([bytes]));
    try {
      assert.equal(book.processing_status, 'queued');
      const response = await processDocument(postProcess(token, { bookId: book.id }));
      assert.equal(response.status, 200);
      assert.equal((await response.json()).processed, true);
      const pages = await pool.query('SELECT page_number, text, word_count FROM book_pages WHERE book_id=$1 ORDER BY page_number', [book.id]);
      assert.equal(pages.rows.length, 1);
      assert.match(pages.rows[0].text, /Hello world/);
      assert.equal(pages.rows[0].word_count, 2);
      const updated = await pool.query('SELECT processing_status, page_count, paragraph_count FROM books WHERE id=$1', [book.id]);
      assert.equal(updated.rows[0].processing_status, 'processed');
      assert.equal(updated.rows[0].page_count, 1);
      assert.equal(updated.rows[0].paragraph_count, 1);
    } finally {
      await deleteBook(user.id, book.id).catch(() => {});
      await pool.query(`DELETE FROM jobs WHERE payload->>'bookId'=$1`, [book.id]);
    }
  });

  test('document job rejects other users books and non-PDF books', async () => {
    const owner = await createUser('pdf-owner');
    const stranger = await createUser('pdf-stranger');
    const strangerToken = await startSession(stranger.id);
    const pdf = await createBook(owner.id, { document_type: 'pdf', file_name: 'owned.pdf', title: 'Owned' }, Readable.from([minimalPdf('Owned text')]));
    const epubBytes = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('epub-bytes')]);
    const epub = await createBook(stranger.id, { document_type: 'epub', file_name: 'book.epub', title: 'Epub' }, Readable.from([epubBytes]));
    try {
      const denied = await processDocument(postProcess(strangerToken, { bookId: pdf.id }));
      assert.equal(denied.status, 400);
      assert.match((await denied.json()).error, /your own books/);
      const wrongType = await processDocument(postProcess(strangerToken, { bookId: epub.id }));
      assert.equal(wrongType.status, 400);
      assert.match((await wrongType.json()).error, /Only PDFs/);
      const anonymous = await processDocument(postProcess(null, { bookId: pdf.id }));
      assert.equal(anonymous.status, 401);
    } finally {
      await deleteBook(owner.id, pdf.id).catch(() => {});
      await deleteBook(stranger.id, epub.id).catch(() => {});
      await pool.query(`DELETE FROM jobs WHERE payload->>'bookId' = ANY($1)`, [[pdf.id, epub.id]]);
    }
  });
});
