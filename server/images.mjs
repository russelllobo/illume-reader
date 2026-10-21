import { Readable } from 'node:stream';
import { stat, unlink } from 'node:fs/promises';
import { pool, transaction } from './database.mjs';
import { commitStaged, discardStaged, filePath, stageObject } from './storage.mjs';
import { requireUser } from './auth.mjs';

const OPENROUTER_IMAGE_URL = 'https://openrouter.ai/api/v1/images';
const MODELS = ['recraft/recraft-v4.1-flash', 'openai/gpt-image-2.5-flare'];
const FREE_LIMIT = 25;
const PRO_LIMIT = 1000;
const IMAGE_LIMIT_BYTES = 10_485_760;

const cleanText = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const cleanId = value => String(value ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
const styleOf = value => value === 'cute' ? 'cute' : 'cartoon';
const monthStart = () => new Date().toISOString().slice(0, 7) + '-01';
const imagePath = (userId, bookId, style, startWord, endWord) => `${userId}/${bookId}/${style}/${startWord}-${endWord}.png`;
const imageUrl = key => `/api/files/reader-images/${key.split('/').map(encodeURIComponent).join('/')}`;
const json = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

function promptFor(title, text) {
  return [
    `You are a book illustrator. Create a visual aid that will appear for this section in the book ${title || 'Uploaded document'}. Don't include text in the picture.`,
    '',
    'Section:',
    text
  ].join('\n');
}

async function planFor(userId) {
  const { rows } = await pool.query('SELECT plan, status FROM billing_profiles WHERE user_id=$1', [userId]);
  const profile = rows[0];
  return profile?.plan === 'pro' && ['active', 'trialing'].includes(profile.status) ? 'pro' : 'free';
}

async function usageCount(userId, plan) {
  const { rows } = await pool.query(
    'SELECT generated_count, monthly_generated_count, monthly_period_start::text AS monthly_period_start FROM reader_image_usage WHERE user_id=$1',
    [userId]
  );
  const usage = rows[0];
  if (plan === 'pro') {
    return usage?.monthly_period_start === monthStart() ? usage.monthly_generated_count : 0;
  }
  return usage?.generated_count ?? 0;
}

async function storedImage(userId, bookId, style, startWord, endWord) {
  const path = imagePath(userId, bookId, style, startWord, endWord);
  const { rows } = await pool.query(
    `SELECT storage_path, prompt FROM reader_images
     WHERE book_id=$1 AND user_id=$2 AND start_word=$3 AND end_word=$4 AND style=$5`,
    [bookId, userId, startWord, endWord, style]
  );
  const record = rows[0];
  const key = record?.storage_path || path;
  const destination = await filePath('reader-images', key, true);
  const exists = await stat(destination).then(item => item.isFile(), () => false);
  if (!exists) return null;
  return { imageUrl: imageUrl(key), prompt: record?.prompt || undefined, path: key };
}

async function renderImage(prompt) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('No image API key configured.');
  let lastError = null;
  for (const model of MODELS) {
    try {
      const response = await fetch(OPENROUTER_IMAGE_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          aspect_ratio: model.startsWith('recraft/') ? '9:16' : '2:3',
          model,
          n: 1,
          output_format: 'png',
          prompt
        })
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error?.message || `Image call failed (${response.status})`);
      const b64 = result?.data?.[0]?.b64_json;
      if (!b64) throw new Error('Image model returned no image data.');
      return {
        bytes: Buffer.from(b64, 'base64'),
        cost: typeof result?.usage?.cost === 'number' ? result.usage.cost : null,
        model,
        mediaType: result?.data?.[0]?.media_type || 'image/png'
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Image generation failed.');
}

export async function generateReaderImage(request) {
  try {
    const user = await requireUser(request);
    const payload = await request.json();
    const bookId = cleanId(payload.bookId);
    const text = cleanText(payload.text, 12_000);
    const title = cleanText(payload.bookTitle, 180);
    const style = styleOf(payload.imageStyle ?? payload.style);
    const startWord = Number(payload.startWord);
    const endWord = Number(payload.endWord);
    if (!bookId) throw new Error('No book was provided for image generation.');
    if (!text) throw new Error('No reading text was provided for image generation.');
    if (!Number.isInteger(startWord) || !Number.isInteger(endWord) || startWord < 1 || endWord < startWord) {
      throw new Error('A valid word range is required for image generation.');
    }

    const book = await pool.query('SELECT id FROM books WHERE id=$1 AND user_id=$2', [bookId, user.id]);
    if (!book.rows[0]) throw Object.assign(new Error('You can only generate images for your own books.'), { statusCode: 403 });
    const plan = await planFor(user.id);
    const limit = plan === 'pro' ? PRO_LIMIT : FREE_LIMIT;
    const stored = await storedImage(user.id, bookId, style, startWord, endWord);
    const count = await usageCount(user.id, plan);
    if (stored) {
      return json({ ...stored, cached: true, imageCount: count, imageLimit: limit, plan });
    }
    if (payload.checkOnly === true) return json({ cached: false, exists: false, imageCount: count, imageLimit: limit, plan });
    const prompt = promptFor(title, text);
    if (payload.promptOnly === true) return json({ cached: false, imageCount: count, imageLimit: limit, plan, prompt, promptSource: 'simple' });

    const period = monthStart();
    const reservation = await pool.query(
      'SELECT generated_count, allowed FROM reserve_reader_image_generation($1,$2,$3,$4::date)',
      [user.id, limit, plan === 'pro', period]
    );
    const reserved = reservation.rows[0];
    if (!reserved?.allowed) {
      return json({
        code: 'reader_image_limit_reached',
        imageCount: Number(reserved?.generated_count ?? limit),
        imageLimit: limit,
        limitReached: true,
        plan,
        upgradeRequired: plan === 'free'
      });
    }

    const path = imagePath(user.id, bookId, style, startWord, endWord);
    let staged = null;
    try {
      const rendered = await renderImage(prompt);
      staged = await stageObject('reader-images', path, Readable.from([rendered.bytes]), {
        maxBytes: IMAGE_LIMIT_BYTES,
        sniff(buffer) {
          const png = buffer[0] === 0x89 && buffer[1] === 0x50;
          const webp = buffer.toString('ascii', 0, 4) === 'RIFF';
          if (!png && !webp) throw new Error('The image provider returned an unexpected file.');
        }
      });
      await commitStaged(staged);
      await transaction(async db => {
        await db.query(
          `INSERT INTO object_files(bucket,path,user_id,size,mime_type,sha256)
           VALUES('reader-images',$1,$2,$3,$4,$5)
           ON CONFLICT(bucket,path) DO UPDATE SET size=excluded.size,mime_type=excluded.mime_type,sha256=excluded.sha256`,
          [path, user.id, staged.size, rendered.mediaType, staged.sha256]
        );
        await db.query(
          `INSERT INTO reader_images(user_id,book_id,start_word,end_word,storage_path,prompt,style)
           VALUES($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT(book_id,start_word,end_word,style)
           DO UPDATE SET storage_path=excluded.storage_path,prompt=excluded.prompt,updated_at=now()`,
          [user.id, bookId, startWord, endWord, path, prompt, style]
        );
      });
      return json({
        cached: false,
        imageCost: rendered.cost,
        imageCount: Number(reserved.generated_count),
        imageLimit: limit,
        imageModel: rendered.model,
        imageUrl: imageUrl(path),
        plan,
        prompt,
        promptSource: 'simple'
      });
    } catch (error) {
      if (staged) {
        await discardStaged(staged);
        if (staged.destination) await unlink(staged.destination).catch(() => {});
      }
      await pool.query('SELECT refund_reader_image_generation($1,$2,$3::date)', [user.id, plan === 'pro', period]);
      throw error;
    }
  } catch (error) {
    const status = error.statusCode || 400;
    return json({ error: status >= 500 ? 'Could not generate image.' : error.message }, status);
  }
}
