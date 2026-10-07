// Session persistence: expo-secure-store (keychain) primary, app-sandbox
// file fallback when the keychain entitlement is missing (seen on the
// simulator Release build: login worked but restart returned to sign-in).
import * as SecureStore from 'expo-secure-store';
import { File, Paths } from 'expo-file-system';
import type { AuthSession } from './types';

const KEY = 'supabase-session';

function fallbackFile() {
  return new File(Paths.document, 'illume-session.json');
}

async function readFallback(): Promise<AuthSession | null> {
  try {
    const file = fallbackFile();
    if (!file.exists) return null;
    const raw = await file.text();
    if (!raw) return null;
    return JSON.parse(raw) as AuthSession;
  } catch {
    return null;
  }
}

async function writeFallback(session: AuthSession) {
  try {
    const file = fallbackFile();
    if (!file.exists) file.create({ intermediates: true });
    file.write(JSON.stringify(session));
  } catch {
    // Best effort: keychain remains the source of truth when it works.
  }
}

async function clearFallback() {
  try {
    const file = fallbackFile();
    if (file.exists) file.delete();
  } catch {}
}

export async function loadSession(): Promise<AuthSession | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (raw) return JSON.parse(raw) as AuthSession;
  } catch {
    // Keychain unavailable (missing entitlement) -> try file fallback.
  }
  return readFallback();
}

export async function saveSession(session: AuthSession) {
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify(session));
  } catch {
    // Keychain unavailable: the sandbox mirror below keeps the login.
  }
  // Always mirror to the sandbox file so a keychain failure never loses
  // the login; loadSession prefers keychain when it succeeds.
  await writeFallback(session);
}

export async function deleteSession() {
  try {
    await SecureStore.deleteItemAsync(KEY).catch(() => {});
  } catch {}
  await clearFallback();
}
