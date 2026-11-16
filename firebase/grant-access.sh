#!/usr/bin/env bash
#
# Lets a device into the database.
#
#   firebase/grant-access.sh <project-id> <uid>
#
# She signs in on her phone, the app shows her a user ID, and it goes in the
# allowlist. That is the whole of self-hosted auth — no Cloud Function, so no
# billing account needed for sign-in alone, and no service-account key for
# anyone to look after.
#
# The Firebase CLI has no command that writes a document, so this uses the REST
# API with an access token. If no token source is available it prints the two
# console clicks instead, because a script that cannot finish should say how to
# finish by hand rather than fail.
set -euo pipefail

PROJECT="${1:-}"
UID_TO_ADD="${2:-}"

if [ -z "$PROJECT" ] || [ -z "$UID_TO_ADD" ]; then
  echo "usage: firebase/grant-access.sh <project-id> <uid>" >&2
  echo "       the uid is shown in the app under Settings → Online booking" >&2
  exit 1
fi

DOC="https://firestore.googleapis.com/v1/projects/$PROJECT/databases/(default)/documents/config/access"

by_hand() {
  cat <<EOF

Do it by hand — it is two clicks and takes less time than fixing this script:

  1. https://console.firebase.google.com/project/$PROJECT/firestore
  2. Start a collection called   config
     with a document called      access
     holding one field:          uids   (array)   →   $UID_TO_ADD

Anyone whose uid is in that array can use the app. Nobody else can, and the
document itself is unreadable and unwritable from the app.
EOF
}

if command -v gcloud >/dev/null 2>&1; then
  TOKEN="$(gcloud auth print-access-token 2>/dev/null || true)"
else
  TOKEN=""
fi

if [ -z "$TOKEN" ]; then
  # No gcloud: use the Firebase CLI's own sign-in instead — the same access
  # `firebase deploy` already has. Only if that fails too is it done by hand.
  if node "$(dirname "$0")/allow.mjs" "$PROJECT" "$UID_TO_ADD"; then
    exit 0
  fi
  echo "Couldn't use the Firebase CLI's sign-in either (run: npx firebase login)."
  by_hand
  exit 0
fi

# Read first, so a second device is added rather than replacing the first.
#
# The read MUST succeed, or be a genuine "not there yet". A failed read that
# was treated as an empty list — a rate limit, a blip, a token that can write
# but not read — made the write below replace the allowlist with only the new
# ID, and her first phone was locked out of her own bookings.
READ_OUT="$(mktemp)"
READ_STATUS="$(curl -s -o "$READ_OUT" -w '%{http_code}' -H "Authorization: Bearer $TOKEN" "$DOC" || echo 000)"
case "$READ_STATUS" in
  200) ;;
  404) : > "$READ_OUT" ;;  # no allowlist yet: this is the first device
  *)
    echo "Couldn't read the current allowlist (HTTP $READ_STATUS), so nothing was changed."
    echo "Adding without reading would replace the devices already allowed in. Try again in a minute."
    rm -f "$READ_OUT"
    exit 1
    ;;
esac
EXISTING="$(python3 -c "
import json,sys
raw = open(sys.argv[1]).read()
d = json.loads(raw) if raw.strip() else {}
vals = d.get('fields', {}).get('uids', {}).get('arrayValue', {}).get('values', [])
print('\n'.join(v.get('stringValue','') for v in vals if v.get('stringValue')))
" "$READ_OUT")" || { echo "The allowlist came back unreadable, so nothing was changed."; rm -f "$READ_OUT"; exit 1; }
rm -f "$READ_OUT"

ALL="$(printf '%s\n%s\n' "$EXISTING" "$UID_TO_ADD" | sed '/^$/d' | sort -u)"
BODY="$(printf '%s\n' "$ALL" | python3 -c "
import json,sys
uids = [u for u in sys.stdin.read().split('\n') if u]
print(json.dumps({'fields': {'uids': {'arrayValue': {'values': [{'stringValue': u} for u in uids]}}}}))
")"

STATUS="$(curl -s -o /tmp/grant-access.out -w '%{http_code}' \
  -X PATCH "$DOC?updateMask.fieldPaths=uids" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "$BODY")"

if [ "$STATUS" = "200" ]; then
  echo "Allowed in:"
  printf '  %s\n' $ALL
else
  echo "Writing the allowlist failed (HTTP $STATUS)." >&2
  head -c 400 /tmp/grant-access.out >&2 || true
  by_hand
  exit 1
fi
