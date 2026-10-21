import { requireUser } from './auth.mjs';

const SPEECHIFY_SPEECH_URL = 'https://api.speechify.ai/v1/audio/speech';
const json = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

const cleanText = value => String(value ?? '')
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 2000);

function wordsFrom(value) {
  const chunks = Array.isArray(value) ? value : value?.chunks;
  if (!Array.isArray(chunks)) return [];
  return chunks.flatMap(word => {
    if (!word || typeof word !== 'object') return [];
    const text = String(word.value ?? word.text ?? '').trim();
    const startRaw = word.start_time ?? word.start;
    const endRaw = word.end_time ?? word.end;
    const start = Number(startRaw);
    const end = Number(endRaw);
    const startSeconds = start > 100 ? start / 1000 : start;
    const endSeconds = end > 100 ? end / 1000 : end;
    if (!text || !Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || endSeconds <= startSeconds) return [];
    return [{ text, start: startSeconds, end: endSeconds }];
  });
}

export async function narrate(request) {
  try {
    await requireUser(request);
    const payload = await request.json();
    const text = cleanText(payload.text);
    if (!text) throw new Error('No text was provided for speech.');
    const key = process.env.SPEECHIFY_API_KEY;
    if (!key) throw new Error('Narration is not configured.');
    const response = await fetch(SPEECHIFY_SPEECH_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio_format: 'mp3', input: text, model: 'simba-3.2', voice_id: 'geffen_32' })
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(result?.message || 'Speechify narration failed.');
    const audio = String(result?.audio_data ?? result?.audio ?? '');
    const base64 = audio.includes(',') ? audio.slice(audio.indexOf(',') + 1) : audio;
    if (!base64.trim()) throw new Error('Speechify returned no audio.');
    return json({ audio: base64.replace(/\s+/g, ''), outputFormat: result?.audio_format || 'mp3', words: wordsFrom(result?.speech_marks ?? result?.words) });
  } catch (error) {
    return json({ error: error.statusCode === 401 ? 'You must be signed in to use narration.' : error.message }, error.statusCode || 400);
  }
}
