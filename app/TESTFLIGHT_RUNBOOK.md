# First TestFlight Upload Runbook

This app is an xtool SwiftPM iOS app:

- Bundle ID: `com.russellsystems.illume`
- App name: `illume reader`
- Minimum iOS: 17
- Entitlements: Sign in with Apple
- Local Linux smoke test: `swift test --filter IllumeCoreTests`
- Local Linux package smoke test: `xtool dev build --configuration release --ipa`

The Linux `.ipa` build confirms the app packages, but the first TestFlight upload still needs macOS/Xcode for App Store signing, archiving, and upload.

## Before Renting The Mac

1. Make sure you can sign in to these accounts:
   - Apple Developer: https://developer.apple.com/account
   - App Store Connect: https://appstoreconnect.apple.com
   - GitHub or wherever this repo is hosted.
2. In Apple Developer, create or confirm the App ID:
   - Identifier: `com.russellsystems.illume`
   - Capability: Sign in with Apple enabled.
3. In App Store Connect, create or confirm the app record:
   - Platform: iOS
   - Name: `illume reader`
   - Bundle ID: `com.russellsystems.illume`
   - SKU: any stable internal string, for example `illume-reader-ios`.
4. In Supabase Auth, confirm redirect URLs include:
   - `https://illumereader.com/auth/native-callback`
   - `com.russellsystems.illume://auth-callback`
5. In Supabase Auth, confirm Apple provider is enabled and includes `com.russellsystems.illume` as a native Apple client ID.
6. For subscriptions, confirm the App Store product exists:
   - Product ID: `illume.pro.monthly`

## On The Rented Mac

1. Install Xcode from the Mac App Store if it is not already installed.
2. Open Xcode once and accept any prompts. If asked, install additional components.
3. Install command line tools if needed:

   ```bash
   xcode-select --install
   ```

4. Clone the repo:

   ```bash
   git clone <repo-url>
   cd <repo>/app
   ```

5. Install xtool if it is not already present. Follow the current xtool install docs for macOS, then verify:

   ```bash
   xtool --version
   ```

6. Generate the Xcode project on macOS:

   ```bash
   xtool dev generate-xcode-project
   ```

7. Open the generated `.xcodeproj` in Xcode.
8. In Xcode, select the app target and set:
   - Team: your Apple Developer team
   - Bundle Identifier: `com.russellsystems.illume`
   - Signing: Automatically manage signing
   - Capability: Sign in with Apple
9. Select a real iOS device or `Any iOS Device (arm64)` as the destination.
10. Build once with `Product > Build`.
11. Archive with `Product > Archive`.
12. When Organizer opens, select the archive and choose `Distribute App`.
13. Choose `App Store Connect`.
14. Choose `Upload`.
15. Let Xcode manage signing automatically unless you already have manual profiles.
16. Upload and wait for App Store Connect processing.

## After Upload

1. Open App Store Connect.
2. Go to the app > TestFlight.
3. Wait until the uploaded build finishes processing.
4. Answer any export compliance prompts.
5. Add yourself to internal testing and install through the TestFlight app.
6. Smoke test:
   - Email/password sign-in or sign-up
   - Google sign-in callback
   - Sign in with Apple
   - Import/open a book
   - Reading progress sync
   - Image generation quota display
   - Pro subscription purchase in sandbox/TestFlight
   - Account deletion

## If Xcode Complains

- `No profiles for com.russellsystems.illume`: confirm the App ID exists in Apple Developer and your Xcode Team is correct.
- `Signing for ... requires a development team`: set Team on the app target.
- `Capability not available`: confirm the paid Apple Developer Program membership is active.
- `Invalid bundle identifier`: make sure Xcode and `xtool.yml` both use `com.russellsystems.illume`.
- `Product ID not found` for subscriptions: confirm `illume.pro.monthly` exists in App Store Connect and the app is using StoreKit sandbox/TestFlight.
- OAuth callback fails: confirm Supabase redirect URLs and the URL scheme in `Info.plist`.

## Local Checks Already Run

These checks passed on Linux on 2026-06-11:

```bash
swift test --filter IllumeCoreTests
xtool dev build --configuration release --ipa
```

The generated Linux package was written to `xtool/IllumeNative.ipa`. It is intentionally ignored by git.
