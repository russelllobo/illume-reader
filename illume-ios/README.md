# Illume (Expo)

React Native + Expo port of the native SwiftUI iOS app. Same Supabase backend:

```text
https://mduemjbplprditrqolcp.supabase.co
```

## Stack

- Expo SDK 57 + React Native 0.86 + TypeScript
- Supabase JS for Auth, Postgres, Storage, Edge Functions
- `expo-secure-store` for session (was Keychain)
- `expo-document-picker` + `expo-file-system` + `jszip` for EPUB import (was ZIPFoundation)
- `expo-speech` for narration (was AVSpeechSynthesizer)
- `expo-iap` (OpenIAP) for `illume.pro.monthly` (was StoreKit 2) — requires a dev build, not Expo Go
- Apple + Google sign-in via `expo-apple-authentication` + hosted OAuth (`expo-web-browser`)

## Run

```bash
npm install
npx expo start
```

Tap-through on your iPhone:

```bash
npx expo run:ios --device
```

IAP / StoreKit needs a dev client + physical device:

```bash
npx expo prebuild --clean
npx expo run:ios --device
```

## Checks

```bash
npm run typecheck
npm test
```

## OTA updates (EAS Update)

JS-only changes ship over the air — no new binary needed. Binaries are pinned
to EAS project `@russelllobo/illume` with `runtimeVersion: { policy: appVersion }`,
so an update only applies to apps with the same `version` in `app.json`.
Native changes (new native module, splash, entitlements, `app.json` ios/android
native keys) still need a fresh device build.

```bash
npm run update:preview     # eas update --channel preview --environment preview
npm run update:production  # eas update --channel production --environment production
```

The app checks on launch (`checkAutomatically: ON_LOAD`) and Profile has a
manual “Check for updates”. Updates publish to EAS channel `preview`
(`production` for store builds) — the installed binary must be from the same
channel.

Local device builds run on the Mac mini (`ssh macmini`, Xcode required):

```bash
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8  # CocoaPods needs UTF-8 over ssh
cd ~/Projects/illume-ios
eas build --local -p ios -e preview  # needs iOS signing for com.illumereader.ios
```

## Notes

- Google OAuth uses `com.illumereader.ios://auth-callback` — must stay in Supabase Auth redirect URLs.
- Bundle ID stays `com.illumereader.ios` (`app.json`).
- PDF text comes from server `book_pages` + `process-reader-document`, same as Swift. Local PDF parsing is intentionally out of scope.
- Swift sources were replaced by this Expo app (see git history before the rewrite commit).
