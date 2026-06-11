#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_PATH="$ROOT_DIR/xtool/.xtool-tmp/IllumeNative.xcodeproj"
ARCHIVE_PATH="$ROOT_DIR/build/IllumeNative.xcarchive"
EXPORT_PATH="$ROOT_DIR/build/testflight-upload"
EXPORT_OPTIONS="$ROOT_DIR/ExportOptions.testflight.plist"
RESOLVED_EXPORT_OPTIONS="$ROOT_DIR/build/ExportOptions.resolved.plist"
DERIVED_DATA="$ROOT_DIR/.derivedData"
SOURCE_PACKAGES="$ROOT_DIR/.xcode-source-packages"

: "${APPLE_TEAM_ID:?Set APPLE_TEAM_ID to your Apple Developer Team ID}"
: "${APPLE_AUTH_KEY_PATH:?Set APPLE_AUTH_KEY_PATH to the App Store Connect API .p8 file path}"
: "${APPLE_AUTH_KEY_ID:?Set APPLE_AUTH_KEY_ID to the App Store Connect API key ID}"
: "${APPLE_AUTH_KEY_ISSUER_ID:?Set APPLE_AUTH_KEY_ISSUER_ID to the App Store Connect issuer ID}"

mkdir -p "$ROOT_DIR/build"
cp "$EXPORT_OPTIONS" "$RESOLVED_EXPORT_OPTIONS"
/usr/libexec/PlistBuddy -c "Set :teamID $APPLE_TEAM_ID" "$RESOLVED_EXPORT_OPTIONS" 2>/dev/null || \
  /usr/libexec/PlistBuddy -c "Add :teamID string $APPLE_TEAM_ID" "$RESOLVED_EXPORT_OPTIONS"

xcodebuild \
  -project "$PROJECT_PATH" \
  -scheme IllumeNative-App \
  -configuration Release \
  -destination "generic/platform=iOS" \
  -archivePath "$ARCHIVE_PATH" \
  -derivedDataPath "$DERIVED_DATA" \
  -clonedSourcePackagesDirPath "$SOURCE_PACKAGES" \
  CODE_SIGNING_ALLOWED=NO \
  archive

xcodebuild \
  -exportArchive \
  -archivePath "$ARCHIVE_PATH" \
  -exportPath "$EXPORT_PATH" \
  -exportOptionsPlist "$RESOLVED_EXPORT_OPTIONS" \
  -allowProvisioningUpdates \
  -authenticationKeyPath "$APPLE_AUTH_KEY_PATH" \
  -authenticationKeyID "$APPLE_AUTH_KEY_ID" \
  -authenticationKeyIssuerID "$APPLE_AUTH_KEY_ISSUER_ID"
