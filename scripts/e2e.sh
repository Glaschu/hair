#!/usr/bin/env bash
# Runs the Maestro end-to-end tests (.maestro/tests/) against a Release build
# on an iPhone simulator. Usage: scripts/e2e.sh   (REBUILD=1 for fresh build)
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/sim-common.sh

require_maestro
build_app

udid=$(ensure_sim iris-maestro-iphone "$PHONE_TYPE")
boot_and_prep "$udid"
maestro --device "$udid" test .maestro/tests/
