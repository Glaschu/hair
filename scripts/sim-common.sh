#!/usr/bin/env bash
# Shared helpers for the Maestro simulator scripts. Source this, don't run it.

MAESTRO_BIN="$HOME/.maestro/bin"
[ -d "$MAESTRO_BIN" ] && export PATH="$PATH:$MAESTRO_BIN"

APP_SCHEME="iris"
CONFIGURATION="${CONFIGURATION:-Release}"
APP_PATH="ios/build/Build/Products/${CONFIGURATION}-iphonesimulator/${APP_SCHEME}.app"

# Device types these scripts target. Override via env if a future Xcode
# drops them, e.g. PHONE_TYPE=com.apple.CoreSimulator.SimDeviceType.iPhone-18-Pro-Max
PHONE_TYPE="${PHONE_TYPE:-com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro-Max}"
IPAD_TYPE="${IPAD_TYPE:-com.apple.CoreSimulator.SimDeviceType.iPad-Pro-13-inch-M4-8GB}"

require_maestro() {
  command -v maestro >/dev/null 2>&1 && return
  echo "error: maestro not found. Install it with:" >&2
  echo "  curl -fsSL https://get.maestro.mobile.dev | bash" >&2
  exit 1
}

# Builds the simulator app (Release bundles the JS, so Metro isn't needed).
# Reuses an existing build; REBUILD=1 forces a fresh one.
build_app() {
  if [ -d "$APP_PATH" ] && [ "${REBUILD:-0}" != "1" ]; then
    echo "Using existing build: $APP_PATH  (REBUILD=1 to force a rebuild)"
    return
  fi
  echo "Building $APP_SCHEME ($CONFIGURATION) for the iOS simulator — first build takes a few minutes…"
  xcodebuild -workspace "ios/${APP_SCHEME}.xcworkspace" \
    -scheme "$APP_SCHEME" \
    -configuration "$CONFIGURATION" \
    -destination 'generic/platform=iOS Simulator' \
    -derivedDataPath ios/build \
    -quiet build
}

# ensure_sim <name> <devicetype-id> — prints the UDID, creating the sim on
# the newest installed runtime if it doesn't exist yet.
ensure_sim() {
  local udid
  udid=$(xcrun simctl list devices \
    | grep -F "$1 (" \
    | grep -oE '[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}' \
    | head -1 || true)
  if [ -z "$udid" ]; then
    udid=$(xcrun simctl create "$1" "$2")
  fi
  echo "$udid"
}

# boot_and_prep <udid> — boots the sim, installs the app, then applies the
# classic App Store status bar (9:41, full battery and signal). The override
# goes last: applied mid-boot it can be lost when SpringBoard finishes.
boot_and_prep() {
  xcrun simctl bootstatus "$1" -b
  xcrun simctl install "$1" "$APP_PATH"
  xcrun simctl status_bar "$1" override \
    --time "9:41" \
    --dataNetwork wifi --wifiMode active --wifiBars 3 \
    --cellularMode active --cellularBars 4 \
    --batteryState charged --batteryLevel 100
}
