import { createHash, randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { z } from 'zod';
import { pool, transaction } from './database.mjs';
import { commitStaged, contentTypeFor, discardStaged, filePath, stageObject } from './storage.mjs';

const FREE_QUOTA = Number(process.env.FREE_STORAGE_QUOTA_BYTES || 104_857_600);
const PRO_QUOTA = Number(process.env.PRO_STORAGE_QUOTA_BYTES || 5_368_709_120);
const EPUB_LIMIT = 5_368_709_120;

const updateSchema = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  author: z.string().max(500).optional(),
  cover_url: z.string().max(2_000_000).nullable().optional(),
  current_index: z.number().int().min(0).max(10_000_000).optional(),
  current_page: z.number().int().min(1).max(1_000_000).optional(),
  last_opened_at: z.string().refine(value => !Number.isNaN(Date.parse(value)), 'Invalid time').optional(),
  page_count: z.number().int().positive().nullable().optional(),
  paragraph_count: z.number().int().min(0).max(10_000_000).optional(),
  chapter_count: z.number().int().min(0).max(100_000).optional(),
  pdf_page_metrics: z.array(z.any()).max(20_000).optional(),
  pdf_toc: z.array(z.any()).max(20_000).optional(),
  processing_status: z.enum(['ready', 'queued', 'processing', 'processed', 'failed']).optional(),
  processing_error: z.string().max(2000).nullable().optional()
}).strict();

const createSchema = z.object({
  title: z.string().max(500).optional(),
  author: z.string().max(500).optional(),
  cover_url: z.string().max(2_000_000).nullable().optional(),
  document_type: z.enum(['epub', 'pdf']),
  file_name: z.string().min(1).max(500),
  paragraph_count: z.number().int().min(0).max(10_000_000).optional(),
  chapter_count: z.number().int().min(0).max(100_000).optional(),
  page_count: z.number().int().positive().nullable().optional(),
  pdf_page_metrics: z.array(z.any()).max(20_000).optional(),
  pdf_toc: z.array(z.any()).max(20_000).optional(),
  current_index: z.number().int().min(0).max(10_000_000).optional(),
  current_page: z.number().int().min(1).max(1_000_000).optional(),
  last_opened_at: z.string().optional()
}).strict();

const httpError = (message, statusCode) => Object.assign(new Error(message), { statusCode });

function lockKey(userId) {
  return createHash('sha256').update(userId).digest().readBigInt64BE(0).toString();
}

function safeFileName(name, documentType) {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^[.-]+|[.-]+$/g, '').slice(0, 160);
  const fallback = documentType === 'pdf' ? 'document.pdf' : 'document.epub';
  return cleaned || fallback;
}

function isPro(profile) {
  return profile?.plan === 'pro' && ['active', 'trialing'].includes(profile.status);
}

async function preserveReaderImageUsage(db, userId) {
  const periodStart = new Date().toISOString().slice(0, 7) + '-01';
  const usage = (await db.query('SELECT generated_count, monthly_generated_count, monthly_period_start::text AS monthly_period_start FROM reader_image_usage WHERE user_id=$1', [userId])).rows[0];
  const total = (await db.query('SELECT count(*)::int AS count FROM reader_images WHERE user_id=$1', [userId])).rows[0].count;
  const monthly = (await db.query('SELECT count(*)::int AS count FROM reader_images WHERE user_id=$1 AND created_at>=$2::date', [userId, periodStart])).rows[0].count;
  const generatedCount = Math.max(usage?.generated_count ?? 0, total);
  const monthlyGeneratedCount = usage?.monthly_period_start === periodStart
    ? Math.max(usage?.monthly_generated_count ?? 0, monthly)
    : monthly;
  await db.query(
    `INSERT INTO reader_image_usage(user_id, generated_count, monthly_generated_count, monthly_period_start)
     VALUES($1,$2,$3,$4::date)
     ON CONFLICT(user_id) DO UPDATE SET generated_count=excluded.generated_count,
       monthly_generated_count=excluded.monthly_generated_count, monthly_period_start=excluded.monthly_period_start, updated_at=now()`,
    [userId, generatedCount, monthlyGeneratedCount, periodStart]
  );
}

async function ownedBook(db, userId, bookId) {
  const { rows } = await db.query('SELECT * FROM books WHERE id=$1 AND user_id=$2', [bookId, userId]);
  return rows[0] ?? null;
}

export async function listBooks(userId) {
  const { rows } = await pool.query(
    'SELECT * FROM books WHERE user_id=$1 ORDER BY last_opened_at DESC NULLS LAST, created_at DESC',
    [userId]
  );
  return rows;
}

export async function updateBook(userId, bookId, patch) {
  const values = updateSchema.parse(patch);
  const assignments = [];
  const parameters = [];
  for (const [column, value] of Object.entries(values)) {
    parameters.push(value);
    assignments.push(`${column}=$${parameters.length}`);
  }
  if (!assignments.length) throw httpError('No changes were provided.', 400);
  parameters.push(bookId, userId);
  const { rows } = await pool.query(
    `UPDATE books SET ${assignments.join(', ')}, updated_at=now() WHERE id=$${parameters.length - 1} AND user_id=$${parameters.length} RETURNING *`,
    parameters
  );
  if (!rows[0]) throw httpError('Book not found.', 404);
  return rows[0];
}

export async function listPages(userId, bookId) {
  const book = await ownedBook(pool, userId, bookId);
  if (!book) throw httpError('Book not found.', 404);
  const { rows } = await pool.query(
    'SELECT page_number, text FROM book_pages WHERE book_id=$1 AND user_id=$2 ORDER BY page_number',
    [bookId, userId]
  );
  return rows;
}

export async function bookFile(userId, bookId) {
  const book = await ownedBook(pool, userId, bookId);
  if (!book) throw httpError('Book not found.', 404);
  const destination = await filePath('epubs', book.storage_path);
  return {
    destination,
    filename: (book.file_name || 'book').replace(/["\r\n\\]/g, ''),
    mimeType: book.mime_type || contentTypeFor(book.storage_path)
  };
}

export async function createBook(userId, metadata, source) {
  const input = createSchema.parse(metadata);
  const id = randomUUID();
  const storagePath = `${userId}/${id}/${safeFileName(input.file_name, input.document_type)}`;
  const mimeType = input.document_type === 'pdf' ? 'application/pdf' : 'application/epub+zip';
  const staged = await stageObject('epubs', storagePath, source, {
    maxBytes: EPUB_LIMIT,
    sniff(buffer) {
      const pdf = buffer.subarray(0, 5).toString('utf8').startsWith('%PDF');
      const epub = buffer[0] === 0x50 && buffer[1] === 0x4b;
      if (input.document_type === 'pdf' ? !pdf : !epub) {
        throw httpError('The file does not match its document type.', 400);
      }
    }
  });
  try {
    await commitStaged(staged);
    return await transaction(async db => {
      await db.query('SELECT pg_advisory_xact_lock($1::bigint)', [lockKey(userId)]);
      const profile = await db.query('SELECT plan, status FROM billing_profiles WHERE user_id=$1', [userId]);
      const quota = isPro(profile.rows[0]) ? PRO_QUOTA : FREE_QUOTA;
      const used = await db.query('SELECT COALESCE(sum(size),0)::bigint AS used FROM object_files WHERE user_id=$1', [userId]);
      if (Number(used.rows[0].used) + staged.size > quota) throw httpError('This upload would exceed your library limit.', 413);
      await db.query(
        `INSERT INTO object_files(bucket,path,user_id,size,mime_type,sha256) VALUES('epubs',$1,$2,$3,$4,$5)`,
        [storagePath, userId, staged.size, mimeType, staged.sha256]
      );
      const inserted = await db.query(
        `INSERT INTO books(
          id,user_id,title,author,cover_url,document_type,storage_path,file_name,file_size,mime_type,
          page_count,paragraph_count,chapter_count,pdf_page_metrics,pdf_toc,processing_status,
          current_index,current_page,last_opened_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16,$17,$18,$19
        ) RETURNING *`,
        [
          id, userId, (input.title || '').trim(), (input.author || '').trim(), input.cover_url ?? null,
          input.document_type, storagePath, input.file_name, staged.size, mimeType, input.page_count ?? null,
          input.paragraph_count ?? 0, input.chapter_count ?? 0, JSON.stringify(input.pdf_page_metrics ?? []),
          JSON.stringify(input.pdf_toc ?? []), input.document_type === 'pdf' ? 'queued' : 'ready',
          input.current_index ?? 0, input.current_page ?? 1, input.last_opened_at ?? new Date().toISOString()
        ]
      );
      if (input.document_type === 'pdf') {
        await db.query(
          `INSERT INTO jobs(kind,payload) VALUES('process-reader-document',$1::jsonb)`,
          [JSON.stringify({ bookId: id, userId })]
        );
      }
      return inserted.rows[0];
    });
  } catch (error) {
    await unlink(staged.destination).catch(() => {});
    await discardStaged(staged);
    throw error;
  }
}

export async function deleteBook(userId, bookId) {
  const removed = await transaction(async db => {
    await preserveReaderImageUsage(db, userId);
    const images = await db.query('SELECT storage_path FROM reader_images WHERE book_id=$1 AND user_id=$2', [bookId, userId]);
    const book = await db.query('DELETE FROM books WHERE id=$1 AND user_id=$2 RETURNING storage_path', [bookId, userId]);
    if (!book.rows[0]) throw httpError('Book not found.', 404);
    const paths = [{ bucket: 'epubs', path: book.rows[0].storage_path }, ...images.rows.map(row => ({ bucket: 'reader-images', path: row.storage_path }))];
    for (const item of paths) {
      await db.query('DELETE FROM object_files WHERE bucket=$1 AND path=$2 AND (user_id=$3 OR user_id IS NULL)', [item.bucket, item.path, userId]);
    }
    return paths;
  });
  for (const item of removed) {
    const destination = await filePath(item.bucket, item.path, true).catch(() => null);
    if (destination) await unlink(destination).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

export async function enqueueDocumentProcessing(userId, bookId) {
  const book = await ownedBook(pool, userId, bookId);
  if (!book) throw httpError('Book not found.', 404);
  if (book.document_type !== 'pdf') return book;
  await pool.query(
    `UPDATE books SET processing_status='queued', processing_error=NULL, updated_at=now()
     WHERE id=$1 AND user_id=$2 AND processing_status IN ('queued','failed','ready')`,
    [bookId, userId]
  );
  await pool.query(
    `INSERT INTO jobs(kind,payload)
     SELECT 'process-reader-document', $1::jsonb
     WHERE NOT EXISTS (
       SELECT 1 FROM jobs
       WHERE kind='process-reader-document' AND payload->>'bookId'=$2 AND status IN ('queued','processing')
     )`,
    [JSON.stringify({ bookId, userId }), bookId]
  );
  const { rows } = await pool.query('SELECT * FROM books WHERE id=$1 AND user_id=$2', [bookId, userId]);
  return rows[0];
}

export async function accountSummary(userId) {
  const monthStart = new Date().toISOString().slice(0, 7) + '-01';
  const [profile, usage, saved, monthly] = await Promise.all([
    pool.query('SELECT * FROM billing_profiles WHERE user_id=$1', [userId]),
    pool.query('SELECT generated_count, monthly_generated_count, monthly_period_start FROM reader_image_usage WHERE user_id=$1', [userId]),
    pool.query('SELECT count(*)::int AS count FROM reader_images WHERE user_id=$1', [userId]),
    pool.query('SELECT count(*)::int AS count FROM reader_images WHERE user_id=$1 AND created_at>=$2::date', [userId, monthStart])
  ]);
  return {
    billing_profile: profile.rows[0] ?? null,
    image_usage: usage.rows[0] ?? null,
    saved_image_count: saved.rows[0].count,
    monthly_saved_image_count: monthly.rows[0].count
  };
}
