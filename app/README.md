# Illume iOS

Native SwiftUI iOS app for the existing Illume reader backend.

Free accounts use the shared 100 MB library quota. Pro accounts use a 5 GB library quota and the StoreKit-backed Pro image allowance.

## Stack

- SwiftUI for iOS 17+
- Swift Package Manager + xtool
- Supabase Swift for Auth, Postgres, Storage, and Edge Functions
- StoreKit 2 for the `illume.pro.monthly` Pro subscription

## Backend

The app connects to the same Supabase project as `/home/russ/Documents/Projects/reader`:

```text
https://mduemjbplprditrqolcp.supabase.co
```

Dashboard/admin functionality is intentionally out of scope.

## Google Sign-In

Google sign-in uses Supabase hosted OAuth with an iOS callback scheme. Enable Google as an Auth provider in Supabase, then make sure the app bundle `Info.plist` contains:

```xml
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLSchemes</key>
    <array>
      <string>com.illumereader.ios</string>
    </array>
  </dict>
</array>
```

The same callback URL, `com.illumereader.ios://auth-callback`, must be allowed in Supabase Auth redirect URLs.

## Local Checks

```bash
swift test --filter IllumeCoreTests
xtool dev run
```

`swift test` validates the pure Swift core on Linux. SwiftUI, StoreKit, AuthenticationServices, and device signing require the iOS SDK/device flow through `xtool` or Xcode.

## StoreKit Backend Secrets

Deploy the new Supabase functions with these secrets configured:

```bash
supabase secrets set \
  APPLE_BUNDLE_ID=com.illumereader.ios \
  APPLE_APP_APPLE_ID=<numeric-app-id> \
  APPLE_ROOT_CERTIFICATES_BASE64=<comma-separated-base64-der-certs>
```

For sandbox-only local testing, `APPLE_DISABLE_SIGNATURE_VERIFICATION=true` bypasses JWS certificate verification. Do not use that bypass in production.
