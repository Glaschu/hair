#!/usr/bin/env bash
# Captures App Store screenshots on the two simulators Apple requires:
#   iPhone 6.9"  → 1320×2868 px   (iPhone 17 Pro Max)
#   iPad 13"     → 2064×2752 px   (iPad Pro 13-inch, portrait)
# Output lands in screenshots/, ready to upload in App Store Connect.
#
# Usage: scripts/appstore-screenshots.sh          (reuses last build)
#        REBUILD=1 scripts/appstore-screenshots.sh (forces a fresh build)
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/sim-common.sh

require_maestro
build_app

capture() { # <sim-name> <devicetype> <flow> <outdir>
  local udid
  udid=$(ensure_sim "$1" "$2")
  echo "── $1 ($udid) → $4"
  boot_and_prep "$udid"
  rm -rf "$4" && mkdir -p "$4"
  maestro --device "$udid" test -e OUTPUT_DIR="$PWD/$4" "$3"
  xcrun simctl shutdown "$udid" >/dev/null 2>&1 || true
}

capture iris-maestro-iphone "$PHONE_TYPE" .maestro/screenshots-iphone.yaml screenshots/iphone-6.9
capture iris-maestro-ipad   "$IPAD_TYPE"  .maestro/screenshots-ipad.yaml   screenshots/ipad-13

echo
echo "── Captured sizes (App Store wants 1320×2868 iPhone, 2064×2752 iPad) ──"
for f in screenshots/*/*.png; do
  printf '%-45s %s\n' "$f" \
    "$(sips -g pixelWidth -g pixelHeight "$f" | awk '/pixel/ {print $2}' | paste -sd x -)"
done
echo
echo "Upload in App Store Connect → your app → iOS App version → App Previews and Screenshots."
