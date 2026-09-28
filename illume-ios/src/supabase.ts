// Port of SupabaseBackend.swift using @supabase/supabase-js + direct storage calls.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config';
import { libraryByRecentActivity, camelCaseKeys, DEFAULT_USER_STORAGE_QUOTA_BYTES } from './lib';
import type {
  AuthSession,
  AuthUser,
  BillingProfile,
  BookPage,
  BookRow,
  ReaderImageFunctionResponse,
  ReaderImageUsage,
  ReaderImageStyle,
} from './types';

export const STORAGE_QUOTA_BYTES = DEFAULT_USER_STORAGE_QUOTA_BYTES;

let client: SupabaseClient | null = null;
export function supabase(): SupabaseClient {
  if (!client) client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  return client;
}

async function authed(path: string, accessToken: string, init?: RequestInit) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Request failed: ${res.status}`);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export async function signIn(email: string, password: string): Promise<AuthSession> {
  const { data, error } = await supabase().auth.signInWithPassword({ email, password });
  if (error || !data.session) throw error ?? new Error('Sign in failed');
  return toSession(data.session as any);
}

export async function signUp(email: string, password: string): Promise<AuthSession> {
  const { data, error } = await supabase().auth.signUp({ email, password });
  if (error || !data.session) throw error ?? new Error('Sign up failed — check email confirmation');
  return toSession(data.session as any);
}

export async function refreshSession(refreshToken: string): Promise<AuthSession> {
  const { data, error } = await supabase().auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data.session) throw error ?? new Error('Session refresh failed');
  return toSession(data.session as any);
}

export async function exchangeIdToken(provider: 'apple' | 'google', idToken: string, nonce?: string): Promise<AuthSession> {
  const { data, error } = await supabase().auth.signInWithIdToken({ provider, token: idToken, nonce });
  if (error || !data.session) throw error ?? new Error('OAuth exchange failed');
  return toSession(data.session as any);
}

function toSession(s: { access_token: string; refresh_token?: string; expires_in?: number; token_type?: string; user: { id: string; email?: string } }): AuthSession {
  return {
    accessToken: s.access_token,
    refreshToken: s.refresh_token ?? null,
    expiresIn: s.expires_in ?? null,
    tokenType: s.token_type ?? null,
    user: { id: s.user.id, email: s.user.email ?? null },
  };
}

export async function loadUser(accessToken: string): Promise<AuthUser> {
  const row = await authed('/auth/v1/user', accessToken, { method: 'GET' });
  return { id: row.id, email: row.email ?? null };
}

export async function loadLibrary(accessToken: string): Promise<BookRow[]> {
  const rows = await authed('/rest/v1/books?select=*&order=last_opened_at.desc.nullslast,created_at.desc', accessToken, {
    method: 'GET',
  });
  return libraryByRecentActivity(camelCaseKeys<BookRow[]>(rows));
}

export async function loadBillingProfile(accessToken: string): Promise<BillingProfile | null> {
  const rows = await authed('/rest/v1/billing_profiles?select=*&limit=1', accessToken, { method: 'GET' });
  const row = (rows as unknown[])[0];
  return row ? camelCaseKeys<BillingProfile>(row) : null;
}

export async function loadReaderImageUsage(accessToken: string) {
  const rows = (await authed('/rest/v1/reader_image_usage?select=*&limit=1', accessToken, { method: 'GET' })) as unknown[];
  return rows[0] ? camelCaseKeys<ReaderImageUsage>(rows[0]) : null;
}

export async function loadBookPages(bookId: string, accessToken: string): Promise<BookPage[]> {
  return camelCaseKeys<BookPage[]>(await authed(
    `/rest/v1/book_pages?select=*&book_id=eq.${bookId.toLowerCase()}&order=page_number.asc`,
    accessToken,
    { method: 'GET' }
  ));
}

export async function saveProgress(bookId: string, currentIndex: number, currentPage: number, accessToken: string) {
  await authed(`/rest/v1/books?id=eq.${bookId.toLowerCase()}`, accessToken, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ current_index: currentIndex, current_page: currentPage, last_opened_at: new Date().toISOString() }),
  });
}

export async function insertBook(book: BookRow, accessToken: string): Promise<BookRow> {
  const rows = await authed('/rest/v1/books?select=*', accessToken, {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(toSnake(book)),
  });
  const row = (rows as BookRow[])[0];
  if (!row) throw new Error('Insert failed');
  return row;
}

export async function uploadDocument(data: Uint8Array, storagePath: string, mimeType: string, accessToken: string) {
  const encoded = storagePath.split('/').map(encodeURIComponent).join('/');
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/epubs/${encoded}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': mimeType,
      'x-upsert': 'false',
    },
    body: data as any,
  });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
}

export async function downloadDocument(storagePath: string, accessToken: string): Promise<Uint8Array> {
  const encoded = storagePath.split('/').map(encodeURIComponent).join('/');
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/epubs/${encoded}`, {
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

export async function invokeReaderImage(
  payload: { bookId: string; startWord: number; endWord: number; text: string; style: ReaderImageStyle },
  accessToken: string
): Promise<ReaderImageFunctionResponse> {
  return (await authed('/functions/v1/generate-reader-image', accessToken, {
    method: 'POST',
    body: JSON.stringify({ book_id: payload.bookId, start_word: payload.startWord, end_word: payload.endWord, text: payload.text, style: payload.style }),
  })) as ReaderImageFunctionResponse;
}

export async function deleteBook(bookId: string, accessToken: string) {
  await authed('/functions/v1/delete-reader-book', accessToken, {
    method: 'POST',
    body: JSON.stringify({ bookId: bookId.toLowerCase() }),
  });
}

export async function queuePdfProcessing(bookId: string, accessToken: string) {
  await authed('/functions/v1/process-reader-document', accessToken, {
    method: 'POST',
    body: JSON.stringify({ bookId: bookId.toLowerCase() }),
  });
}

export async function syncAppleSubscription(
  payload: { signedTransactionInfo: string; appTransaction?: string | null },
  accessToken: string
) {
  return await authed('/functions/v1/sync-apple-subscription', accessToken, {
    method: 'POST',
    body: JSON.stringify({ signedTransactionInfo: payload.signedTransactionInfo, appTransaction: payload.appTransaction ?? null }),
  });
}

function toSnake(obj: any): any {
  if (Array.isArray(obj)) return obj.map(toSnake);
  if (obj && typeof obj === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(obj)) {
      const sk = k.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
      out[sk] = toSnake(v);
    }
    return out;
  }
  return obj;
}
