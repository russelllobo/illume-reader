// Port of KeychainStore.swift -> expo-secure-store
import * as SecureStore from 'expo-secure-store';
import type { AuthSession } from './types';

const KEY = 'supabase-session';

export async function loadSession(): Promise<AuthSession | null> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AuthSession;
  } catch {
    return null;
  }
}

export async function saveSession(session: AuthSession) {
  await SecureStore.setItemAsync(KEY, JSON.stringify(session));
}

export async function deleteSession() {
  await SecureStore.deleteItemAsync(KEY).catch(() => {});
}
