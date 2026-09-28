import Constants from 'expo-constants';

export const SUPABASE_URL =
  (Constants.expoConfig?.extra as any)?.supabaseUrl ?? 'https://hiswlrweciottgskunlc.supabase.co';

// Publishable key from the Swift app (SupabaseConfig.publishableKey).
// For production, move this to EAS env / expo-constants extra.
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_45QqkC64abbEjt2gS77xFw_kDHT1vcH';

export const APP_SCHEME = 'com.russellsystems.illume';

export const OAUTH_BRIDGE_URL =
  'https://illumereader.com/auth/native-callback';
export const AUTH_CALLBACK = `${APP_SCHEME}://auth-callback`;
