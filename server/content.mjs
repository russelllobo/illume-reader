import { readFile } from 'node:fs/promises';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { pool } from './database.mjs';
import { getUser, requireUser } from './auth.mjs';
import { filePath, signedFileUrl } from './storage.mjs';

const OWNER_EMAIL = 'r.lobo2003@gmail.com';
const BOOK_BUCKET = 'epubs';
const IMAGE_BUCKET = 'reader-images';

const json = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const cleanId = (value, maxLength = 80) => String(value ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, maxLength);
const normaliseSpace = text => String(text ?? '').replace(/\s+/g, ' ').trim();
const wordCount = text => Array.from(String(text ?? '').matchAll(/\S+/g)).length;
const dateKey = value => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
};
const objectOwnerId = name => String(name || '').split('/').filter(Boolean)[0] ?? '';
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function documentTypeOf(book) {
  return book.document_type ?? (String(book.file_name || '').toLowerCase().endsWith('.pdf') ? 'pdf' : 'epub');
}

async function textFromPage(page) {
  const content = await page.getTextContent();
  const lines = [];
  let currentLine = '';
  for (const item of content.items) {
    if (!('str' in item)) continue;
    const text = item.str.trim();
    if (text) currentLine = currentLine ? `${currentLine} ${text}` : text;
    if (item.hasEOL) {
      if (currentLine) lines.push(currentLine);
      currentLine = '';
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines.join('\n');
}

function destName(dest) {
  if (dest && typeof dest === 'object' && 'name' in dest && typeof dest.name === 'string') return dest.name;
  return typeof dest === 'string' ? dest : '';
}

function topValueFromDest(dest) {
  const name = destName(dest[1]);
  switch (name) {
    case 'XYZ': return typeof dest[3] === 'number' ? dest[3] : null;
    case 'FitH':
    case 'FitBH': return typeof dest[2] === 'number' ? dest[2] : null;
    case 'FitR': return typeof dest[5] === 'number' ? dest[5] : null;
    default: return null;
  }
}

async function resolveDestTarget(pdf, dest) {
  const resolvedDest = typeof dest === 'string' ? await pdf.getDestination(dest).catch(() => null) : dest;
  const ref = resolvedDest?.[0];
  if (!ref) return null;
  let pageNumber = null;
  if (typeof ref === 'object') {
    const index = await pdf.getPageIndex(ref).catch(() => null);
    pageNumber = typeof index === 'number' ? index + 1 : null;
  } else if (typeof ref === 'number') {
    pageNumber = ref + 1;
  }
  if (!pageNumber) return null;
  const top = Array.isArray(resolvedDest) ? topValueFromDest(resolvedDest) : null;
  if (typeof top !== 'number') return { pageNumber, pageOffsetRatio: 0 };
  const page = await pdf.getPage(pageNumber).catch(() => null);
  if (!page) return { pageNumber, pageOffsetRatio: 0 };
  const viewport = page.getViewport({ scale: 1 });
  const [, viewportY] = viewport.convertToViewportPoint(0, top);
  return { pageNumber, pageOffsetRatio: clamp(viewportY / viewport.height, 0, 1) };
}

async function collectTocEntries(pdf) {
  const outline = await pdf.getOutline().catch(() => null);
  if (!outline?.length) return [];
  const entries = [];
  const visit = async (nodes, level) => {
    for (const node of nodes) {
      const title = normaliseSpace(node.title ?? '');
      const target = await resolveDestTarget(pdf, node.dest);
      if (title && target && target.pageNumber >= 1 && target.pageNumber <= pdf.numPages) {
        const previous = entries.at(-1);
        if (!(previous?.title === title && previous.pageNumber === target.pageNumber)) {
          entries.push({ level, ...target, title });
        }
      }
      if (node.items?.length) await visit(node.items, level + 1);
    }
  };
  await visit(outline, 0);
  return entries;
}

function buildUserJourney({ books, images, user }) {
  return [
    user.created_at ? { at: user.created_at, detail: 'Account created', label: 'Signed up', type: 'sign_up' } : null,
    user.last_sign_in_at
      ? { at: user.last_sign_in_at, detail: 'Latest local sign-in', label: 'Signed in', type: 'sign_in' }
      : null,
    ...books.map(book => ({
      at: book.created_at,
      detail: `${book.title || book.file_name} · ${documentTypeOf(book).toUpperCase()}`,
      label: 'Uploaded book',
      type: 'book_upload'
    })),
    ...images.map(image => ({
      at: image.created_at,
      detail: `${image.style ?? 'cartoon'} image · words ${image.start_word}-${image.end_word}`,
      label: 'Generated image',
      type: 'image_generated'
    }))
  ]
    .filter(event => Boolean(event?.at))
    .sort((left, right) => right.at.localeCompare(left.at));
}

function buildTimeline({ books, bookSizes, generatedAt, imageSizes, images, users }) {
  const events = new Map();
  const ensureEvent = date => {
    const existing = events.get(date);
    if (existing) return existing;
    const event = { booksBytes: 0, booksCount: 0, date, imagesBytes: 0, imagesCount: 0, usersCount: 0 };
    events.set(date, event);
    return event;
  };
  users.forEach(user => {
    const date = dateKey(user.created_at);
    if (date) ensureEvent(date).usersCount += 1;
  });
  books.forEach(book => {
    const date = dateKey(book.created_at);
    if (!date) return;
    const event = ensureEvent(date);
    event.booksCount += 1;
    event.booksBytes += bookSizes.get(book.storage_path) ?? Number(book.file_size ?? 0);
  });
  images.forEach(image => {
    const date = dateKey(image.created_at);
    if (!date) return;
    const event = ensureEvent(date);
    event.imagesCount += 1;
    event.imagesBytes += imageSizes.get(image.storage_path) ?? 0;
  });
  const today = dateKey(generatedAt);
  if (today) ensureEvent(today);
  const totals = { booksBytes: 0, booksCount: 0, imagesBytes: 0, imagesCount: 0, usersCount: 0 };
  return [...events.values()]
    .sort((left, right) => left.date.localeCompare(right.date))
    .map(event => {
      totals.booksBytes += event.booksBytes;
      totals.booksCount += event.booksCount;
      totals.imagesBytes += event.imagesBytes;
      totals.imagesCount += event.imagesCount;
      totals.usersCount += event.usersCount;
      return {
        booksBytes: totals.booksBytes,
        booksCount: totals.booksCount,
        date: event.date,
        imagesBytes: totals.imagesBytes,
        imagesCount: totals.imagesCount,
        storageBytes: totals.booksBytes + totals.imagesBytes,
        usersCount: totals.usersCount
      };
    });
}

function buildUserTimeline({ books, bookSizes, generatedAt, imageSizes, images, user }) {
  return buildTimeline({
    books,
    bookSizes,
    generatedAt,
    imageSizes,
    images,
    users: user.created_at ? [user] : []
  });
}

export async function readerDashboard(request) {
  try {
    if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
    const user = await getUser(request);
    if (!user?.email) return json({ error: 'Sign in with Google to view this dashboard.' }, 401);
    if (String(user.email).toLowerCase() !== OWNER_EMAIL) {
      return json({ error: 'This dashboard is only available to the reader project owner.' }, 403);
    }
    const [users, books, images, waitlist, objects] = await Promise.all([
      pool.query('SELECT id, email, created_at, last_sign_in_at FROM users').then(result => result.rows),
      pool.query('SELECT created_at, document_type, file_name, file_size, id, storage_path, title, user_id FROM books')
        .then(result => result.rows),
      pool.query('SELECT book_id, created_at, end_word, id, prompt, start_word, storage_path, style, user_id FROM reader_images')
        .then(result => result.rows),
      pool.query('SELECT created_at, email, id, launch_context, source FROM launch_waitlist_signups ORDER BY created_at DESC')
        .then(result => result.rows),
      pool.query(`SELECT bucket, path, size, user_id FROM object_files WHERE bucket IN ('epubs','reader-images')`)
        .then(result => result.rows)
    ]);
    const bookObjects = objects.filter(object => object.bucket === BOOK_BUCKET);
    const imageObjects = objects.filter(object => object.bucket === IMAGE_BUCKET);
    const sizeOf = object => (Number.isFinite(Number(object.size)) ? Number(object.size) : 0);
    const bookStorageFallback = books.reduce((total, book) => total + Number(book.file_size ?? 0), 0);
    const bookStorageBytes = bookObjects.reduce((total, object) => total + sizeOf(object), 0) || bookStorageFallback;
    const imageStorageBytes = imageObjects.reduce((total, object) => total + sizeOf(object), 0);
    const bookSizeByPath = new Map(bookObjects.map(object => [object.path, sizeOf(object)]));
    const imageSizeByPath = new Map(imageObjects.map(object => [object.path, sizeOf(object)]));
    const imageSignedUrls = new Map(
      [...new Set(images.map(image => image.storage_path).filter(Boolean))]
        .map(path => [path, signedFileUrl(IMAGE_BUCKET, path, 3600)])
    );
    const bookTitlesById = new Map(books.map(book => [book.id, book.title]));
    const generatedAt = new Date().toISOString();
    const timeline = buildTimeline({ books, bookSizes: bookSizeByPath, generatedAt, imageSizes: imageSizeByPath, images, users });
    const byUser = users.map(user => {
      const userBooks = books.filter(book => book.user_id === user.id);
      const userImages = images.filter(image => image.user_id === user.id);
      const userBookObjectBytes = bookObjects
        .filter(object => objectOwnerId(object.path) === user.id)
        .reduce((total, object) => total + sizeOf(object), 0);
      const userImageObjectBytes = imageObjects
        .filter(object => objectOwnerId(object.path) === user.id)
        .reduce((total, object) => total + sizeOf(object), 0);
      return {
        bookStorageBytes: userBookObjectBytes || userBooks.reduce((total, book) => total + Number(book.file_size ?? 0), 0),
        books: userBooks
          .sort((left, right) => right.created_at.localeCompare(left.created_at))
          .map(book => ({
            createdAt: book.created_at,
            documentType: documentTypeOf(book),
            fileName: book.file_name,
            fileSize: Number(book.file_size ?? 0),
            id: book.id,
            title: book.title
          })),
        createdAt: user.created_at ?? null,
        email: user.email ?? 'No email',
        id: user.id,
        imageStorageBytes: userImageObjectBytes,
        images: userImages
          .sort((left, right) => right.created_at.localeCompare(left.created_at))
          .map(image => ({
            bookId: image.book_id,
            bookTitle: bookTitlesById.get(image.book_id) ?? 'Unknown book',
            createdAt: image.created_at,
            endWord: image.end_word,
            id: image.id,
            prompt: image.prompt,
            signedUrl: imageSignedUrls.get(image.storage_path) ?? null,
            startWord: image.start_word,
            style: image.style ?? 'cartoon'
          })),
        imagesGenerated: userImages.length,
        journey: buildUserJourney({ books: userBooks, images: userImages, user }),
        lastSignInAt: user.last_sign_in_at ?? null,
        timeline: buildUserTimeline({ books: userBooks, bookSizes: bookSizeByPath, generatedAt, imageSizes: imageSizeByPath, images: userImages, user })
      };
    });
    return json({
      generatedAt,
      storage: { booksBytes: bookStorageBytes, imagesBytes: imageStorageBytes, totalBytes: bookStorageBytes + imageStorageBytes },
      totals: { books: books.length, imagesGenerated: images.length, users: users.length },
      timeline,
      users: byUser.sort((left, right) => (right.createdAt ?? '').localeCompare(left.createdAt ?? '')),
      waitlist: waitlist.map(signup => ({
        createdAt: signup.created_at,
        email: signup.email,
        id: signup.id,
        launchContext: signup.launch_context ?? {},
        source: signup.source ?? 'landing_mobile_tablet'
      }))
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Could not load the reader dashboard.' }, 400);
  }
}

async function updateBookStatus(bookId, fields) {
  const assignments = Object.keys(fields).map((column, index) => `${column}=$${index + 1}`);
  const values = Object.values(fields).map(value =>
    typeof value === 'object' && value !== null ? JSON.stringify(value) : value
  );
  values.push(bookId);
  await pool.query(`UPDATE books SET ${assignments.join(', ')} WHERE id=$${values.length}`, values);
}

async function upsertPages(pages) {
  for (let index = 0; index < pages.length; index += 100) {
    const batch = pages.slice(index, index + 100);
    const columns = ['book_id', 'page_number', 'text', 'user_id', 'word_count'];
    const placeholders = [];
    const values = [];
    batch.forEach((page, row) => {
      placeholders.push(`($${values.length + 1},$${values.length + 2},$${values.length + 3},$${values.length + 4},$${values.length + 5})`);
      values.push(page.book_id, page.page_number, page.text, page.user_id, page.word_count);
    });
    await pool.query(
      `INSERT INTO book_pages(${columns.join(',')}) VALUES${placeholders.join(',')}
       ON CONFLICT(book_id,page_number) DO UPDATE SET text=excluded.text, word_count=excluded.word_count, updated_at=now()`,
      values
    );
  }
}

async function processPdfBook(book) {
  await updateBookStatus(book.id, {
    processing_error: null,
    processing_started_at: new Date().toISOString(),
    processing_status: 'processing'
  });
  let pdf = null;
  try {
    const destination = await filePath(BOOK_BUCKET, book.storage_path);
    const bytes = new Uint8Array(await readFile(destination));
    pdf = await pdfjsLib.getDocument({ data: bytes.slice(0), disableWorker: true }).promise;
    const tocEntries = await collectTocEntries(pdf);
    const pageRows = [];
    const pageMetrics = [];
    let extractedPageCount = 0;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const text = normaliseSpace(await textFromPage(page));
      const pageWordCount = wordCount(text);
      pageMetrics.push({ height: viewport.height, width: viewport.width });
      if (text) extractedPageCount += 1;
      pageRows.push({ book_id: book.id, page_number: pageNumber, text, user_id: book.user_id, word_count: pageWordCount });
    }
    await upsertPages(pageRows);
    await updateBookStatus(book.id, {
      chapter_count: tocEntries.length,
      page_count: pdf.numPages,
      paragraph_count: extractedPageCount,
      pdf_page_metrics: pageMetrics,
      pdf_toc: tocEntries,
      processed_at: new Date().toISOString(),
      processing_error: null,
      processing_status: 'processed'
    });
    return { pages: pdf.numPages, tocEntries: tocEntries.length };
  } catch (error) {
    await updateBookStatus(book.id, {
      processing_error: error instanceof Error ? error.message : 'PDF processing failed.',
      processing_status: 'failed'
    });
    throw error;
  } finally {
    await pdf?.destroy().catch(() => {});
  }
}

export async function processDocumentJob({ bookId }) {
  const id = cleanId(bookId);
  if (!id) throw new Error('No book was provided for processing.');
  const { rows } = await pool.query(
    'SELECT document_type, file_name, id, storage_path, user_id FROM books WHERE id=$1',
    [id]
  );
  const book = rows[0];
  if (!book) throw new Error('You can only process your own books.');
  if (book.document_type !== 'pdf') throw new Error('Only PDFs need background processing.');
  return processPdfBook(book);
}

export async function processDocument(request) {
  try {
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    const user = await requireUser(request);
    const payload = await request.json().catch(() => ({}));
    const bookId = cleanId(payload.bookId);
    if (!bookId) throw new Error('No book was provided for processing.');
    const { rows } = await pool.query(
      'SELECT document_type, file_name, id, storage_path, user_id FROM books WHERE id=$1 AND user_id=$2',
      [bookId, user.id]
    );
    const book = rows[0];
    if (!book) throw new Error('You can only process your own books.');
    if (book.document_type !== 'pdf') throw new Error('Only PDFs need background processing.');
    await processPdfBook(book);
    return json({ processed: true });
  } catch (error) {
    const status = error.statusCode || 400;
    return json({ error: status >= 500 ? 'Could not process this document.' : error.message }, status);
  }
}
