#!/usr/bin/env bash
#
# Stands up the Firebase project, rules first.
#
#   firebase/setup.sh <project-id> [region]
#
# The ordering is the point. A Firestore database with no rules deployed is a
# database whose contents depend on a default you did not choose — so the rules
# go up before anything is allowed to write, and the script VERIFIES they took
# rather than assuming they did.
set -euo pipefail
cd "$(dirname "$0")"

PROJECT="${1:-}"
REGION="${2:-europe-west2}"   # London. Her clients are in Glasgow; keep it in the UK.

if [ -z "$PROJECT" ]; then
  echo "usage: firebase/setup.sh <project-id> [region]" >&2
  echo "       e.g. firebase/setup.sh iris-booking-hbj" >&2
  exit 1
fi

fb() { npx --yes firebase "$@"; }

echo "==> Signing in (the stored token is from 2023 and cannot refresh)"
fb login --reauth

echo
echo "==> Project"
if fb projects:list 2>/dev/null | grep -q "$PROJECT"; then
  echo "    using existing $PROJECT"
else
  fb projects:create "$PROJECT" --display-name "Iris Booking"
fi
fb use "$PROJECT"

echo
echo "==> Firestore database in $REGION"
# Point-in-time recovery on from the start: it cannot be applied retroactively
# to the window you wish you had. Delete protection because this ends up
# holding bookings people have paid for.
fb firestore:databases:create "(default)" \
  --location "$REGION" \
  --point-in-time-recovery ENABLED \
  --delete-protection ENABLED \
  || echo "    (already exists — continuing)"

echo
echo "==> Rules and indexes, before any data exists"
fb deploy --only firestore:rules,firestore:indexes --non-interactive

echo
echo "==> Checking the database is actually shut"
# The only honest check. A rules file that deployed is not the same thing as a
# database that refuses — so ask it, as a stranger would, and require a no.
STATUS=$(curl -s -o /dev/null -w '%{http_code}' \
  "https://firestore.googleapis.com/v1/projects/$PROJECT/databases/(default)/documents/bookings")
if [ "$STATUS" = "403" ] || [ "$STATUS" = "401" ]; then
  echo "    unauthenticated read refused ($STATUS) — good"
else
  echo "    !! unauthenticated read returned $STATUS, expected 401 or 403" >&2
  echo "    !! put no client data in this project until that reads 403" >&2
  exit 1
fi

echo
echo "==> Hosting"
fb deploy --only hosting --non-interactive

echo
echo "Done. Site: https://$PROJECT.web.app"
echo
echo "Still to do by hand:"
echo "  1. npx firebase login:ci   → paste into the FIREBASE_TOKEN repo secret"
echo "  2. gh variable set FIREBASE_PROJECT_ID --body $PROJECT"
echo "  3. Sign-in for her devices — see 'What is not yet secured' in firebase/README.md"
