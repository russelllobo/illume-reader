import { describe, test, expect } from '@jest/globals';
import { buildGoogleAuthorizeUrl, parseOAuthCallbackParams, oauthCallbackError } from '../src/oauth';
import { AUTH_CALLBACK } from '../src/config';

describe('google oauth redirect', () => {
  test('callback uses the bundle-id scheme Supabase allowlists via the bridge', () => {
    expect(AUTH_CALLBACK).toBe('com.russellsystems.illume://auth-callback');
  });

  test('authorize url points redirect_to at the https bridge', () => {
    const url = buildGoogleAuthorizeUrl();
    expect(url).toContain('provider=google');
    expect(url).toContain('redirect_to=' + encodeURIComponent('https://illumereader.com/auth/native-callback'));
    expect(url).not.toContain('com.illumereader.ios');
  });

  test('parses implicit-flow fragment tokens from the bridge callback', () => {
    const params = parseOAuthCallbackParams(
      'com.russellsystems.illume://auth-callback#access_token=abc&refresh_token=def&token_type=bearer'
    );
    expect(params.access_token).toBe('abc');
    expect(params.refresh_token).toBe('def');
    expect(oauthCallbackError(params)).toBeNull();
  });

  test('parses query tokens and surfaces provider errors', () => {
    const ok = parseOAuthCallbackParams('com.russellsystems.illume://auth-callback?access_token=abc');
    expect(ok.access_token).toBe('abc');
    const err = parseOAuthCallbackParams('com.russellsystems.illume://auth-callback?error=access_denied&error_description=Denied');
    expect(oauthCallbackError(err)).toBe('Denied');
  });
});
