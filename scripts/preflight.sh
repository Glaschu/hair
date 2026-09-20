#!/usr/bin/env bash
#
# Everything that must be true before a first real deposit.
#
# Written as a script rather than a checklist because a checklist is a list of
# things someone believes, and this is a list of things that can be checked. Run
# it before going live, and again before every deploy that touches money.
#
#   scripts/preflight.sh
#
set -uo pipefail
cd "$(dirname "$0")/.."

pass=0; fail=0; warn=0
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; pass=$((pass+1)); }
no()   { printf '  \033[31m✗\033[0m %s\n'   "$1"; printf '      %s\n' "$2"; fail=$((fail+1)); }
hmm()  { printf '  \033[33m!\033[0m %s\n'   "$1"; printf '      %s\n' "$2"; warn=$((warn+1)); }
head_() { printf '\n\033[1m%s\033[0m\n' "$1"; }

head_ "Tests"

if npx jest --silent >/dev/null 2>&1; then
  ok "app suite"
else
  no "app suite" "npx jest"
fi

if node --test booking/test/integration.test.mjs >/dev/null 2>&1; then
  ok "booking service suite"
else
  no "booking service suite" "node --test booking/test/integration.test.mjs"
fi

if [ -d firebase/node_modules ]; then
  if (cd firebase && npm test >/dev/null 2>&1); then
    ok "rules, resolver, outbox, webhook, reconciler"
  else
    no "firebase suite" "cd firebase && npm test"
  fi
else
  hmm "firebase suite not run" "cd firebase && npm install"
fi

head_ "Money"

# A 50% deposit on a float is a rounding argument waiting to happen.
if grep -qE '^\s+(price|cost|amount)[a-z_]*\s+REAL' booking/worker/schema.sql; then
  no "money is stored as REAL" "integer pence only — see booking/worker/schema.sql"
else
  ok "money is integer pence"
fi

# The refund tiers and the words they describe must travel together.
if grep -q 'tiers' booking/worker/schema.sql; then
  ok "refund tiers are pinned to the policy text"
else
  no "policy has no tiers column" "the wording and the maths can drift apart"
fi

head_ "Keys and recovery"

# Recovery has to exist before a deposit does: after money is attached, an
# envelope nobody can open stops being an inconvenience and becomes a dispute.
if [ -f src/data/recovery.ts ] && grep -q 'canTakeDeposits' src/data/recovery.ts; then
  ok "key recovery exists and gates deposits"
else
  no "no key recovery gate" "src/data/recovery.ts must export canTakeDeposits"
fi

if grep -q 'LSApplicationQueriesSchemes' app.json; then
  ok "app.json declares its URL schemes"
else
  hmm "no LSApplicationQueriesSchemes" "Instagram deep links will silently fall back to the web"
fi

head_ "Exposure"

# Cloudflare Access protects a hostname. It does nothing for *.workers.dev, and
# leaving that on is a second front door to the page that hands out the key.
if grep -qE '^workers_dev\s*=\s*false' booking/worker/wrangler.toml \
   && grep -qE '^preview_urls\s*=\s*false' booking/worker/wrangler.toml; then
  ok "workers.dev and preview URLs are off"
else
  no "a bypass hostname is enabled" "set workers_dev and preview_urls to false"
fi

if grep -q 'ACCESS_AUD' booking/worker/src/index.ts; then
  ok "the setup page verifies its Access token"
else
  no "setup page does not verify Access" "a forged header costs nothing to send"
fi

head_ "Firestore"

# A composite of an equality and a different order-by needs an index, and the
# emulator does not enforce that — so the query passes every test and fails on
# the first real deploy.
if [ -f firebase/firestore.indexes.json ] && grep -q 'nextAttemptAt' firebase/firestore.indexes.json; then
  ok "the outbox query has an index declared"
else
  no "missing index for the outbox drain" "firebase/firestore.indexes.json"
fi

if grep -q "sign_in_provider" firebase/firestore.rules; then
  ok "anonymous sign-in does not satisfy the rules"
else
  no "rules accept any authenticated principal" "anonymous auth would make them public"
fi

# Reading an absent claim THROWS, and a thrown condition denies — locking out
# every device holding a token that predates the claim.
if grep -qE 'request\.auth\.token\.(stylist|salonId|suspended)\b' firebase/firestore.rules; then
  no "a claim is read directly" "use .get(name, default) — an absent claim throws and denies"
else
  ok "claims are read safely"
fi

head_ "Still needs a human"

hmm "Stripe object shapes are unverified" \
    "the payment logic is proven against stubs. Run the drill with 'stripe trigger' against a sandbox."
hmm "offline queue durability is unmeasured" \
    "force-quit the app with queued writes and confirm they land. Nobody documents this."
hmm "the SQLite migration has never run on real data" \
    "rehearse it on a copy of her database before the live one."

printf '\n\033[1m%s passed, %s failed, %s to check by hand\033[0m\n' "$pass" "$fail" "$warn"
[ "$fail" -eq 0 ] || printf '\033[31mNot ready to take a deposit.\033[0m\n'
exit $([ "$fail" -eq 0 ] && echo 0 || echo 1)
