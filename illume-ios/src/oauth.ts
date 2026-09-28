// Google OAuth via Supabase hosted authorize + HTTPS bridge (same pattern as
// the SwiftUI app): Supabase redirects to OAUTH_BRIDGE_URL (allowlisted),
// the bridge 302s to APP_SCHEME://auth-callback, and the in-app browser
// session completes. Pure helpers so the URL logic is unit-testable.

import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, OAUTH_BRIDGE_URL } from './config';

export const buildGoogleAuthorizeUrl = (): string =>
  SUPABASE_URL +
  '/auth/v1/authorize?provider=google&redirect_to=' +
  encodeURIComponent(OAUTH_BRIDGE_URL) +
  '&apikey=' +
  encodeURIComponent(SUPABASE_PUBLISHABLE_KEY);

export const parseOAuthCallbackParams = (url: string): Record<string, string> => {
  const params: Record<string, string> = {};
  const q = url.split('?')[1]?.split('#')[0] ?? '';
  const frag = url.split('#')[1] ?? '';
  const parts = (q + '&' + frag).split('&');
  for (const part of parts) {
    const eq = part.indexOf('=');
    const k = eq >= 0 ? part.slice(0, eq) : part;
    const v = eq >= 0 ? part.slice(eq + 1) : '';
    if (k) params[decodeURIComponent(k)] = decodeURIComponent(v);
  }
  return params;
};

export const oauthCallbackError = (params: Record<string, string>): string | null =>
  params.error_description ?? params.error ?? null;
