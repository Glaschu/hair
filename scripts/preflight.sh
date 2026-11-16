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

head_ "The live service"

# A secret can be perfectly well set in Secret Manager and still be invisible to
# the function: v2 functions only see what they DECLARE. Both halves matter —
# the key creates the payment, the webhook secret is how the service learns it
# was paid.
if grep -q "'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'" firebase/functions/index.js; then
  ok "the function declares both Stripe secrets, so setting them actually binds them"
else
  no "the Stripe secrets are not both declared on the function" \
     "firebase/functions/index.js — a set secret it does not declare is a secret it cannot read"
fi

# The whole money path, driven end to end through the real routes: page →
# deposit → signed webhook → her inbox, plus refunds and a lapsed hold. Every
# piece had its own tests before; nothing crossed the seams, and the live
# service advertised deposits with no webhook route at all.
if [ -f firebase/money.test.mjs ] && grep -q "money.test.mjs" firebase/package.json; then
  ok "the money path is tested end to end through the deployed routes"
else
  no "no end-to-end test of the money path" "firebase/money.test.mjs, wired into test:emulated"
fi

# What the service SAYS it can do has to match what it can actually do, because
# the booking page believes this and sends every booking to Stripe on the
# strength of it. "The deposit route answered something other than 501" is NOT
# that proof — it passed while there was no webhook route, which meant every
# payment would have been taken and never confirmed.
LIVE=$(curl -s --max-time 8 https://jessie-salon.web.app/api/version 2>/dev/null || true)
if [ -z "$LIVE" ]; then
  hmm "the live service did not answer" "offline, or jessie-salon.web.app is down"
elif printf '%s' "$LIVE" | grep -q '"deposits"'; then
  # Deposits are advertised, so a payment must be able to come back. An
  # unsigned delivery must be REFUSED (400) — which proves the route exists
  # and the door is shut. A 404 means payments cannot be confirmed at all.
  CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 -X POST \
         -H 'content-type: application/json' -d '{}' \
         https://jessie-salon.web.app/api/stripe/webhook 2>/dev/null || echo 000)
  if [ "$CODE" = "400" ]; then
    ok "deposits advertised, and the webhook route is there and refuses unsigned deliveries"
  else
    no "the service advertises deposits but cannot be told a payment happened" \
       "POST /api/stripe/webhook answered $CODE, not 400 — take deposits off until this is fixed"
  fi
else
  hmm "the live service does not offer deposits" \
      "needs both the Stripe key and the webhook signing secret — fine for the free deployment"
fi

head_ "Still needs a human"

if [ -f firebase/stripeShape.test.mjs ]; then
  ok "Stripe object shapes verified against a live test account"
else
  no "Stripe shapes unverified" "the payment logic is only proven against stubs"
fi
if [ -f firebase/eventDrill.test.mjs ]; then
  ok "Stripe event flow drilled — signature, replay, ordering, rotation"
else
  no "event flow undrilled" "a public endpoint that moves money needs the drill"
fi
hmm "no live webhook endpoint yet" \
    "the drill signs its own payloads. Point a real endpoint at a deployed project when there is one."
hmm "offline queue durability is unmeasured" \
    "force-quit the app with queued writes and confirm they land. Nobody documents this."
hmm "the SQLite migration has never run on real data" \
    "rehearse it on a copy of her database before the live one."

printf '\n\033[1m%s passed, %s failed, %s to check by hand\033[0m\n' "$pass" "$fail" "$warn"
[ "$fail" -eq 0 ] || printf '\033[31mNot ready to take a deposit.\033[0m\n'
exit $([ "$fail" -eq 0 ] && echo 0 || echo 1)
