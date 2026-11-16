#!/usr/bin/env bash
# Runs the feature-verification Maestro flows on iPhone + iPad and drops
# screenshots in screenshots/features-* for visual review.
# Usage: scripts/feature-check.sh   (REBUILD=1 to rebuild the app first)
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/sim-common.sh

require_maestro
build_app

run_flow() { # <sim-name> <devicetype> <flow> <outdir>
  local udid
  udid=$(ensure_sim "$1" "$2")
  echo "── $1 ($udid) → $4"
  boot_and_prep "$udid"
  rm -rf "$4" && mkdir -p "$4"
  maestro --device "$udid" test -e OUTPUT_DIR="$PWD/$4" "$3"
  xcrun simctl shutdown "$udid" >/dev/null 2>&1 || true
}

run_flow iris-maestro-iphone "$PHONE_TYPE" .maestro/features-iphone.yaml screenshots/features-iphone
run_flow iris-maestro-ipad   "$IPAD_TYPE"  .maestro/features-ipad.yaml   screenshots/features-ipad

echo
echo "── Feature screenshots ──"
ls screenshots/features-iphone screenshots/features-ipad
