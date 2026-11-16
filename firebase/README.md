<!-- LOOP LOG — newest first. Each pass appends here.
     Answer anything under "Questions for James" inline and it gets picked up
     next pass. Nothing else in this file is written by the loop. -->

# Loop log

## 12 Nov — third review: undo, sign-in errors, phone matching

**Not yet deployed.** The live service runs the previous round's code. To ship
this round (the new outbox index takes a few minutes to build afterwards):

    cd firebase && npx firebase deploy --only functions,firestore:indexes --project jessie-salon

Until the index is built the outbox tidy fails and logs an error; refunds are
not affected.

- **Cloudflare:** re-registering without a policy no longer wipes her terms
  (Firebase already worked this way).
- **Undo:** cancel sends run one at a time, and the device remembers which
  cancellations the service acknowledged. Undo says "already refunded" only
  for those; one this device never sent gets a hedged message instead.
- **Errors:** pull-to-refresh and the cancel sheet say "sign in again" / "no
  longer linked" / "service in trouble" rather than "check your connection".
- **Phone matching:** `0044…`, `+44 (0)…` and bare `44…` UK mobiles match
  `07…`; numbers from other countries are left whole.
- **CI deploy:** "everything" now includes functions (before hosting); new
  "functions" target.
- **Outbox tidy:** queries only pending rows (new `state + createdAt` index),
  paged, so kept rows can't stall it.
- **Deposits** are shown in pounds everywhere — the service charges GBP.

Suites: app 278, Firebase 143 + 184, Cloudflare 65, tsc clean, preflight 16/0.
Not tried on a device.

## 12 Oct — deployed, and a real deposit drilled end to end

**Deployed** to `jessie-salon.web.app`: functions (including the new scheduled
refund job), the booking and setup pages, Firestore rules and indexes. Deposits
are **off** (the webhook secret is the placeholder `unset`). Preflight: 16
passed, 0 failed. The Cloudflare Worker was **not** deployed — `wrangler` isn't
logged in on this machine, and `wrangler.toml` still has a placeholder D1 id.

**The drill, run automatically** — the real app in the iOS simulator (Release
build, no Metro), against the live service, with Stripe in test mode:

1. Linked the app by pasting the setup code, signed in, allowlisted, admitted —
   the salon registered through the new authenticated route.
2. Sent a link from a client card (two clients both called "Ada Drill", no
   phone numbers). The default policy was set and pinned; the client sealed in.
3. In Safari: booked 10:00, agreed to the policy, paid the £22.50 deposit with
   4242 4242 4242 4242.
4. "You're in the book" — confirmed by the return page asking Stripe (no
   webhook needed). Hour taken, messages queued.
5. Pull on Today: the appointment landed on **the exact Ada the link was sent
   to**, and her card gained the phone number and email she typed.
6. Cancelled it in the app — "I'm cancelling: refund all £22.50" — the link
   was withdrawn and the **refund reached Stripe** on the first attempt.

So the stored restricted key (`rk_test_…`) **can** create checkouts and issue
refunds — that question is answered.

**Found by the drill, all fixed:**

- **Setting up online booking had never worked on a phone.** The secure random
  source (`react-native-get-random-values`) was a dependency nobody imported,
  so making the salon's keys threw — silently, in a Release build. Now imported
  first thing, wired into tweetnacl explicitly, and the setup screen reports
  any error instead of doing nothing.
- A phone can't scan its own screen, and a simulator has no camera: the setup
  page now has **Copy code**, and the app takes a pasted code.
- The client confirmation page showed "…" instead of the salon's name.
- The add-client button had no label (invisible to VoiceOver).
- `grant-access.sh` needed gcloud, which isn't installed here; it now uses the
  Firebase CLI's own sign-in instead (`firebase/allow.mjs`).

**Left exactly as found:** the live database is empty again, the drill's
sign-in account is deleted, deposits are off. The drill flows are in
`.maestro/drill/`.

**Questions for James.**

1. To turn deposits on for real: register the webhook in Stripe (see "After
   pass 17", question 1) and set its signing secret. The key itself is proven.
   *Answer:*

2. To deploy the Cloudflare version: `npx wrangler login`, then a real D1
   database id in `booking/worker/wrangler.toml`. Or is Firebase the one?
   *Answer:*

---

## 11 Oct — days off, and a booking window that's real

**Days off.** Settings → Working hours → Days off (phone and iPad), or
"Block off this day" at the top of any day on the calendar. Tap the first and
last day of a break, add a note like "Holiday" if she likes. From then on:

- never offered in Send link;
- shown as off on both calendars (struck through, "OFF" in the week strip, a
  banner on the day itself with "Open this day");
- booking one in the app warns "You've blocked this day off (Holiday)";
- **refused by the booking service itself**, including times in links already
  sent, an hour freed by a client cancelling, and a client mid-payment (they're
  refunded in full). Opening the day again brings those times back.
- anything already booked on those days is listed for her straight away. It's
  never cancelled for her.

Days off sync between phone and iPad through iCloud, and each change is sent
to the booking service (retried on the next pull if there's no signal).

**Releasing days.** Settings → Booking window now controls how far ahead Send
link offers times (it was fixed at 28 days whatever the setting said).

**Deploy note:** the app has a new local table (migration 0009), the Cloudflare
database has a new `days_off` table. The Worker deploy now applies
`schema.sql` before deploying, so that happens automatically.

**Questions for James.** The deploy question below still stands.

---

## 10 Oct — cancelling from her diary, money alerts, and her policy

**Cancelling a web booking in the app now reaches the service.** If a deposit
was taken, she's asked who is cancelling, with the real amounts shown:
"I'm cancelling: refund all £45", or "They asked: refund £22.50 (your policy)".
The service refunds that, frees the hour, and withdraws the client's link so
they can't book straight back into the time she called off. With no signal she
still makes the choice. It's saved on the phone and sent with the time she
pressed cancel, so the client's notice is measured from then. Undo takes back a
cancellation that hasn't been sent yet. If it has been sent, undo warns her
that only her diary will change.

**Money that needs her is shown.** Disputes, refunds that failed or couldn't be
sent, payments that didn't match, and payments with no booking appear as a
banner on Today. It leads to a list that says what happened and exactly
what to do in Stripe. Each one can be marked as dealt with, and comes back if
anything new happens with that payment.

**She can edit her cancellation policy** (Settings → Online booking, phone and
iPad). On a deposit-taking service she also sets the refund schedule: full
refund with at least 24h, 48h, 3 days or a week; then 25, 50 or 75% back with
less notice, or nothing. Clients see the schedule as plain lines under her
words, so what they agree to always includes what will actually happen.
Changes apply to new links; links already sent keep their terms.

**Also:** the iPad can now pull web bookings itself (pull down on Today).
Before, it only ever got them second-hand through iCloud.

**Deploy note:** this touches both services — the Firebase functions and the
Cloudflare Worker (`deploy-worker`), plus the booking page on both.

**Questions for James.** The deploy question below still stands.

---

## 9 Oct — review, and links that land on the right client

**Links now match back to the client automatically.** "Send link" on a client
card already made a link; the booking just never came back to that card —
intake guessed from the phone number, or made a new card. The client is now
sealed into the link itself, readable by any of her paired devices and by
nobody else, so a booking lands on the card the link was sent from whichever
device pulls it in. Phone and email are the fallback. If someone else books
through it (a forwarded link), the appointment says "Booked online as …" and
their number stays off her card. A missing phone or email on her card is filled
in from the booking, never overwritten.

**Fixed in review:**

- A client who cancelled from their link stayed in her diary as booked, on both
  deployments. Cancellations now come back through the inbox and mark the
  appointment cancelled.
- The Cloudflare inbox delivered bookings that were already cancelled as live
  appointments.
- Her cancellation policy was never sent to the service, so no client was ever
  asked to agree to the 48 hours. It's now set before the first link goes out.
- The invite text promised a 50% deposit even where none is taken.
- Booking one hour from a link kept that link's other hours unbookable for
  every other client for three weeks (both deployments).
- Backing out of Stripe left the client's own hold in place, so every time
  looked gone. Trying again from the same page then said "no longer active".
- A forged Host header could choose where Stripe sent a payer afterwards.
- Junk instead of a sealed envelope took the hour and sat in her inbox for
  good (both deployments).
- Two devices pulling the same new client at once made two cards.
- A mistyped password showed `auth/email-already-in-use`.

**Not done, worth knowing:** when Jessie cancels a web booking *in the app*, the
service isn't told — the hour stays taken there, and a deposit isn't refunded
automatically. Disputes and refund failures are recorded but nothing shows them
to her. There's no screen to edit the cancellation policy yet.

**Questions for James.** Questions 1 and 2 under "After pass 17" still stand.

3. **Deploy?** The live site still advertises deposits with no webhook route,
   so online booking there is broken until this goes out. I can deploy now with
   a placeholder webhook secret: deposits stay off, free booking works, and all
   of the above goes live.
   *Answer:*

---

## After pass 17 — 23 Sep — review fixes: the money path, and Firebase for the app

**A correction first.** Pass 16 said "Deposits are on". They were advertised,
but they did not work: the service had **no webhook route**, so a paid deposit
could never confirm, and the booking page sends every booking through Stripe
whenever deposits are advertised. The live site is still running that code
until the fix below is deployed. My proof in pass 16 — "the deposit route
answers 404, not 501" — proved the key was bound, not that a payment could
complete. Preflight now checks the right thing, and **fails against the live
service today**, which is correct.

**The money path, fixed as one piece** — 16 new end-to-end tests
(`money.test.mjs`) drive page → deposit → signed webhook → her inbox through
the real routes, with Stripe faked statefully:

- A webhook route, behind the signature door, re-fetching truth from Stripe.
- **The return page asks the server to check with Stripe**, through the same
  confirm path. A booking no longer depends on webhook delivery alone.
- Confirming **takes the slot** in the same transaction. If the hold lapsed and
  the hour went to someone else, the late payer is **refunded in full**
  automatically, and nobody is double-booked.
- Cancelling **issues the refund the page promised** (100% / 50% / 0% of the
  deposit by notice), queued with the cancellation and paid out by a scheduled
  drain. It is refunded once however often the drain runs.
- Free booking can't bypass a required deposit, and can't take an hour
  someone is paying for.
- **Deposits are only offered when BOTH the Stripe key and the webhook secret
  are set.** The key alone is exactly the broken state the live site is in.

Two of the fixes were mutation-checked: reverting each one makes the
end-to-end tests fail.

**The Firebase deployment's app side.** It had no stylist API at all: the app
could not register the salon, make a link, or revoke one there. Added
ID-token-authenticated routes that mirror the Cloudflare ones, checked the way
the rules check. The app now carries the Firebase project through setup and
pairing, stays signed in across restarts (it was signed out on every restart),
asks the database itself whether it's been let in (the old check could never
say yes), and no longer loses a just-imported booking to an iCloud sync that
was already in flight.

**Not yet proven on a device:** the Firebase sign-in, persistence and probe are
thin wrappers over the SDK, checked by the type-checker, not by a test. The
drill covers them.

**Questions for James.**

1. **Register the webhook in Stripe** (Developers → Webhooks → Add endpoint):
   `https://jessie-salon.web.app/api/stripe/webhook`, with events
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, `checkout.session.expired`,
   `charge.refunded`, `charge.refund.updated`, `charge.dispute.created`. Then
   `cd firebase && npx firebase functions:secrets:set STRIPE_WEBHOOK_SECRET` and
   paste the `whsec_…` at the prompt, never into a file.
   *Answer:*

2. **Which key?** The stored key is the restricted `rk_test_…`. It now needs
   Checkout Sessions (write), PaymentIntents and Charges (read), and Refunds
   (write). Simplest in test mode: set the secret to the `sk_test_…` key
   instead.
   *Answer:*

3. **Deploy now, without deposits?** The live booking page is broken until the
   fix is deployed. I can deploy with a placeholder webhook secret. Deposits
   then stay off, and free booking works again straight away. Once (1) is done,
   the real secret switches them on.
   *Answer:*

---

## Pass 17 — 23 Sep — the paid booking that would never have arrived

No answers this pass, so the drill is still waiting on you. Went to wire the
deposit button into the booking page and found **two defects on the way**, one
of them the worst kind this project has.

**A paid deposit would never have reached her diary.**

`handleEvent` moved `classification` to `confirmed` when Stripe confirmed a
payment — and never touched `status`. The booking stayed at
`status: 'pending_payment'` forever. The inbox her device reads asks for
`status == 'confirmed'`. So:

> client pays → Stripe confirms → classification advances → **status never moves
> → the inbox never sees it → the appointment never arrives.**
>
> Money taken. No booking. Nobody told.

That is precisely the outcome this whole design exists to prevent, and it was
sitting in the deployed service. The two fields mean different things —
`classification` is what the MONEY did, `status` is what the BOOKING is — and
only one of them was being moved.

Fixed so status follows, **only ever out of `pending_payment`**, so a webhook
landing late cannot resurrect a booking she has already cancelled. Four tests
pin it, including that a refund does not quietly cancel an appointment
(cancelling is its own flow, with its own notice and tiers).

**Second defect: a deposit booking had no client on it.** `startDeposit` never
stored the sealed envelope, so even once the first bug was fixed she would have
got an appointment with no name and no number. It has to be captured *before*
the money moves — the webhook arrives long after the page holding those details
has closed, and there is no later moment to collect a name in. It now refuses to
take money without one, enforces the cancellation policy server-side like
`book()` does, and records what was agreed against the policy the link served.

**The page.** The deposit panel and the checkout hand-off are in, branching on
`link.depositMinor` — what the SERVICE said it can do, never a build flag, so
the same page serves the free Cloudflare deployment unchanged. Failure copy says
*"Nothing has been charged"*, because the one thing someone fears at that moment
is having paid into a void.

Deployed, and verified the release rather than the upload: the live `book.js`
serves `startCheckout`.

**Next.** Your drill. Step 4 now has a real button to press.

**Questions for James.**

1. Run the drill — `docs/device-drill.md`. Twenty minutes, one phone.
   *Answer:*

2. **At step 4, does Stripe checkout actually open?** If it says "couldn't start
   the payment", the restricted key (`rk_test_…`) lacks Checkout scope and we
   swap it for `sk_test_…`. Last unproven link in the chain.
   *Answer:*

3. Rotating the keys you pasted into chat, whenever suits.
   *Answer:*

---

## Pass 16 — 23 Sep — deposits are live, and the reason they were not

Answers, at last. Acted on all three.

**Deposits are on.** You had set `STRIPE_SECRET_KEY` correctly — and the
function still could not see it. **A v2 function only reads secrets it
DECLARES.** Without `secrets: ['STRIPE_SECRET_KEY']` in the `onRequest` options,
`process.env.STRIPE_SECRET_KEY` is undefined, `stripeClient()` returns null, and
the deposit route answers 501 exactly as though no key had ever been set.
Nothing anywhere says why. Declared it, redeployed:

```
capabilities  … "live-sync","deposits","refunds"      ← was missing both
POST /deposit  404 "expired"  (unknown link)          ← was 501 "not enabled"
```

The 404 is the proof, not the capabilities line: it means `stripeClient()`
returned a real client and the route got as far as looking the link up.

The first deploy printed `Error: There was an error deploying functions` while
the capabilities flipped anyway — transient, during the IAM grant on the secret.
I did not take either signal on trust; re-ran it clean (`Deploy complete`, exit
0, no changes) and confirmed the behaviour directly.

**Domain:** leaving `jessie-salon.web.app`, as you said.

**One thing I could not verify, and you should know about it.** The key in
Secret Manager is the **restricted** key (`rk_test_…`), not the standard
`sk_test_…`. Restricted keys only do what their scopes allow, and creating a
Checkout Session may not be one of them. I deliberately did not test that by
pulling the key out and calling Stripe myself — a secret should not pass through
my hands to an outside service. It gets proven properly at step 4 of the drill,
and `docs/device-drill.md` says what each outcome means and how to swap the key.

**Two preflight checks added** for the trap above: that the function *declares*
the secret, and that a service advertising `deposits` is not simultaneously
answering 501 on the deposit route. A set-but-unbound secret can never be
silent again.

**`docs/device-drill.md`** — the drill you said yes to. Twenty minutes, one
phone. The two steps that matter: pull down twice and watch nothing duplicate,
and force-quit mid-pull and watch the booking survive exactly once. That last
one retires one of the three preflight items needing a human.

**Next.** You run the drill; I act on what you see. Meanwhile I will wire the
deposit into the booking page so step 4 has a button to press.

**Questions for James.**

1. Run the drill when you have twenty minutes — `docs/device-drill.md`. Tell me
   the step number if anything looks off.
   *Answer:*

2. **At step 4, does Stripe checkout actually open?** If it says "could not
   start payment", the restricted key lacks Checkout scope and we swap it for
   the `sk_test_…` one. That is the last unproven link in the payment chain.
   *Answer:*

3. Still worth rotating the keys you pasted into chat earlier, whenever suits.
   *Answer:*

---

## Pass 15 — 23 Sep — bookings reach the diary

Fifth pass with no answers, so Stripe and the domain are still untouched.
Finished the inbox: a booking made on the web now arrives in her diary when she
pulls down on the morning screen. That is the whole path working end to end on
both deployments, minus taking money.

**Done.**

`src/data/intakeStore.ts` — commits a batch to SQLite in one transaction, and
**deliberately not through React state.** `runIntake` tells the service a
booking is safe the moment `apply` resolves, so `apply` resolving has to mean
the rows are on disk. A state setter resolves when React has been *asked* to
re-render, which is a different and much earlier moment — going through it
would have reopened exactly the window the ordering exists to close.

`src/data/inboxFor.ts` — the one function in the app that knows there are two
deployments. It caught a bug I had just written: on a Firebase deployment it
fell through to the HTTP inbox, and **there is no `/api/bookings` there** — only
the public booking routes are Functions. That would have 404'd on every refresh
with nothing to explain it, and the symptom she reports is "bookings never
arrive". Now it builds the Firestore reader instead, and a test holds the door
shut.

`src/data/firestoreDb.ts` — the real Firestore behind the two-method interface,
sharing the `iris` app instance with the auth adapter *because that is where the
ID token lives*. A second instance would be unauthenticated and every read
denied. `markBookingSeen` runs in a real transaction, since the rules enforce
compare-and-swap and the version written has to be the version actually there.

Pull-to-refresh on Today. Two things it will not do: fail silently, or lose
anything by failing. An envelope that will not open raises a dialog — she has to
know someone is coming even when the name will not read — and a failed pull says
"pull down again", because nothing was acknowledged, so nothing was lost.

**Next.** A real device drill: book on the live site, pull on the phone, confirm
it lands once and only once. Everything below that is tested; this is the part
only hardware can answer. Then the offline force-quit drill preflight has been
asking for.

**Questions for James.**


2. **Set `STRIPE_SECRET_KEY` (test) on the deployed function?** One command
   (`firebase functions:secrets:set`, never a file). Turns the deposit route's
   501 into a real checkout and lets me put 4242… through end to end.
   *Answer:*yest i have set value

3. `jessie-salon.web.app` or a custom domain? Cosmetic, but a client sees it.
   *Answer:*anything currently

4. Want me to walk you through the device drill next pass — make a booking on
   the live site, pull down on your phone — so we see it land once for real?
   *Answer:*yes

---

## Pass 14 — 23 Sep — the last few feet, and a booking that could never be cleared

Fourth pass with no answers, so the Stripe key and the domain are still
untouched. Built the piece the auth work was always *for*: getting a booking off
the service and into her diary. Found a real defect doing it.

**The defect.** Her device clears the inbox by writing `seenAt`. The rules
enforce compare-and-swap on everything she edits — every write must carry
`version + 1` — and **that expression does not evaluate to 1 on a document with
no version, it ERRORS, and an erroring rule denies.** Neither `book()` nor
`startDeposit` was writing a version. So every booking either deployment created
was one she could never clear: it would redeliver to her diary forever, with
nothing anywhere reporting a fault. Proven against the real rules in the
emulator before fixing:

```
DENIED  : versionless, seenAt only          ← what the inbox would have done
DENIED  : versionless, bumping to 1         ← the obvious fix, also denied
ALLOWED : versioned, proper bump
```

Both writers now stamp `version: 0` at birth, and four tests in `rules.test.mjs`
hold it there. **Deployed** — rules and functions — because bookings taken on
the live service between now and the fix would have had the problem baked in.

**Done besides.**

`src/data/intake.ts` — turning a web booking into an appointment, 21 tests. The
ordering *is* the design: **the diary is written first, and the booking is
acknowledged only after that commits.** Chosen so the failure mode is a
duplicate delivery rather than a lost Saturday. At-least-once delivery, applied
idempotently — the local id is derived from the service's id, so a booking
delivered twice collides with itself instead of becoming two appointments.
That dedupe survives a restart and a restore from backup, which a lookup would
not.

Three things it refuses to do: acknowledge anything the diary did not take;
drop an envelope that will not open (that is a real booking whose details are
unreadable — it stays in the inbox so recovering the right key still rescues
it); or create a second client card for a regular whose number is saved as
`+44 7700 900123` when she typed `07700 900123`.

`src/data/firestoreInbox.ts` — the same inbox on Firebase, 9 tests. She reads
Firestore directly under the rules, so there is no second authenticated API to
keep in step with the first. It emits exactly the shape the Worker does, so
`intake` never learns which deployment it is on. It also only ever asks for
**confirmed** bookings: a `pending_payment` one has a Checkout open and no money
behind it, and in her diary that is a Saturday filled by someone who never paid.

**Next.** Wire the inbox to the app's database writes and a pull-to-refresh —
the logic is done and tested, what is left is the screen. Still genuinely
blocked on question 2 for anything further on payments.

**Questions for James.**

1. Rotating the test keys you pasted. Fourth pass asking.
   *Answer:*

2. **Set `STRIPE_SECRET_KEY` (test) on the deployed function?** One command
   (`firebase functions:secrets:set`, never a file). Turns the deposit route's
   501 into a real checkout and lets me put 4242… through end to end. It is the
   only untried step left in the payment story.
   *Answer:*

3. `jessie-salon.web.app` or a custom domain? Cosmetic, but a client sees it.
   *Answer:*

---

## Pass 13 — 23 Sep — the deposit route ships, switched off

**Still no answers**, so the live key and the domain are untouched. Built the
part that does not need them: the deposit route is now **deployed and inert**,
so saying yes to question 2 is a one-line change rather than a day's work.

**Done.**

`src/stripeClient.mjs` — the whole Stripe client this service needs, hand-rolled
rather than pulling the SDK in. It is one form-encoded POST, and a function that
starts faster is a booking page that feels quicker. **It returns `null` when no
key is configured**, which is what makes the route inert rather than present and
broken:

```
/api/version                  capabilities: booking-links, offsite-backup, live-sync
POST /api/l/<token>/deposit   501  ← "deposits not enabled on this service"
```

Two encoding details that are silently expensive to get wrong, both now tested:
Stripe wants nested objects as `a[b][c]=v`, and the **idempotency key is a
header, not a field** — as a field it is ignored, every retry becomes a new
session, and that is a second charge.

`viewLink` now reports `depositMinor` (null where there is no Stripe) and
**hides slots someone else is mid-checkout on**, reading the hold's expiry
rather than trusting a sweeper to have run. One page serves both deployments:
it reads what the service says it can do instead of assuming.

The redirect origin is taken from the request rather than configured, so the
same code works on `jessie-salon.web.app`, a custom domain, and the emulator
with no setting to drift out of step.

**Next.** Genuinely blocked on question 2 now. Everything up to "take the
payment" is built, deployed and tested; the only untried step is a real test
card going through.

**Questions for James.**

1. Rotating the test keys. Third pass asking — the service is live now.
   *Answer:*

2. **Set `STRIPE_SECRET_KEY` (test) on the deployed function?** One command
   (`firebase functions:secrets:set`, never a file). It flips the 501 above into
   a working checkout and lets me pay with 4242… end to end. This is the last
   unverified step in the whole payment story.
   *Answer:*

3. `jessie-salon.web.app` or a custom domain? Only cosmetic, but a client sees
   it. Happy to leave it if you are.
   *Answer:*

---

## Pass 12 — 23 Sep — deposits built, not switched on

**No answers since last pass**, so I left the live Stripe secret and the domain
alone — both were gated on your say-so and the service is live now. Did the two
things that were not.

**Done.**

**The cost leak is closed.** `functions:artifacts:setpolicy` was looking in
`us-central1` while the function is in `europe-west2`; it takes `--location`.
Old container images now expire after 3 days instead of accumulating forever on
a deployment that is meant to cost pennies.

**The deposit endpoint exists** — `src/deposit.mjs`, 16 tests, Stripe injected
so none of it needed the live key.

The decisions worth knowing:

- **The session is created before the hold is written.** The other order leaks a
  hold on every failed attempt — there is a test where Stripe refuses and the
  hour is still free.
- **`expires_at` is never left to default.** Stripe's default is 24 hours, which
  would hold a Saturday morning until Sunday. It asks for the 30-minute floor.
- **Held is not taken.** Only a signed webhook takes a slot. Coming back from
  Stripe is navigation, not proof — and treating the redirect as proof is the
  commonest way a deposit gets taken with no booking behind it.
- **Holds lapse by being read**, not by a sweeper having run. The sweeper only
  tidies, so an outage in it can never block a booking.
- The booking id goes in **both** `client_reference_id` and
  `payment_intent_data.metadata`, because a PaymentIntent has neither and the
  reconciler walks PaymentIntents. That was verified against the live API in
  pass 8 rather than assumed.

There is also a test for the nastiest race: somebody books the slot in the
moment Stripe takes to answer, and the hold does not stomp their booking.

**Next.** Wiring `startDeposit` into the deployed function and taking a real
test payment — but that is question 2 below, and I would rather not put a key on
a live service without you saying so.

**Questions for James.**

1. Rotating the test keys. Now the most overdue item on this list.
   *Answer:*

2. **Set `STRIPE_SECRET_KEY` (test) on the deployed function?** That switches
   `deposits` and `refunds` on in the capability report and lets me take a real
   test payment end to end with card 4242…. Nothing live, and I would use
   `firebase functions:secrets:set` so it never lands in a file.
   *Answer:*

3. `jessie-salon.web.app` or a custom domain? A client sees this URL, and it is
   the one thing here that is cosmetic but public.
   *Answer:*

---

## Pass 11 — 22 Sep — it is live

**Answers picked up.** Blaze upgraded, `jessie-salon` confirmed. Both were the
blockers, so this pass deployed for real.

**Done. The booking service is running on a real URL.**

https://jessie-salon.web.app

```
/              200   the booking page
/setup         200   the pairing page
/api/version   200   {"service":"iris-booking","api":1,
                      "capabilities":["booking-links","offsite-backup","live-sync"]}
/api/l/<bad>   404   refused, as it should be
/b/<token>     200   "Book an appointment"
```

Pages and API share an origin, so there is no CORS to open — the property the
design has been insisting on since the Cloudflare version, now true of this one
too.

Two things went wrong and are worth writing down:

**Hosting refused `../booking/site`** — a public directory has to live inside
the project directory. Fixed the same way the shared modules were: copied in by
a predeploy hook and gitignored, so there is still one home in the repo and no
second copy to drift from the one the tests scrape.

**The first deploy uploaded everything and then failed at the very end** on an
artifact cleanup policy, which aborted the hosting *release*. The files were
there, the site served "Site Not Found", and the deploy log said
"file upload complete" — which reads like success. Redeploying hosting alone
finished it. Worth knowing: upload complete is not release complete.

**Still outstanding (small).** `functions:artifacts:setpolicy` looks in
`us-central1` while the function is in `europe-west2`, so it cannot find the
repository. Old container images will accumulate a little storage cost until
that is set. Not urgent, but it is the kind of thing that quietly makes a
"pennies" deployment cost more than pennies.

**Next.** A test deposit end to end: set a Stripe secret on the function, mint a
link, pay it with a test card, and watch the webhook confirm it. That is the
last thing the design has never seen happen for real.

**Questions for James.**

1. Rotating the test keys — still outstanding, and now more worth doing since
   the service is live.
   *Answer:*

2. Ready for me to set `STRIPE_SECRET_KEY` on the deployed function so it can
   take a **test** deposit? It flips `deposits` and `refunds` on in the
   capability report. I would use the test key, never a live one.
   *Answer:*

3. Do you want a custom domain on it (`book.hairbyjessie…`), or is
   `jessie-salon.web.app` fine for now? A client sees this URL.
   *Answer:*

---

## Pass 10 — 22 Sep — deployed for real, against jessie-salon

**Answers picked up.** You re-authed Firebase and installed the Stripe CLI, and
confirmed the free Cloudflare version takes **no deposits** — which is already
how it behaves, so nothing changed there.

**Done — this is the first pass that touched a real project.**

`firebase projects:list` found an existing **`jessie-salon`**, with a Firestore
database and no indexes, so it was the obvious target rather than a new one.
Before deploying I checked it was unused: deny-by-default rules would lock out
anything already running, and nothing of hers depends on this project yet
because the app has never talked to Firestore.

Deployed **rules and indexes only** — not hosting or functions, which need
Blaze. Then asked the live database, as a stranger, whether it would answer:

```
bookings  403 refused    days           403 refused
clients   403 refused    outbox         403 refused
config/access 403 refused    public/profile 404  ← allowed, and empty
```

That last line is right, not a hole: `public/profile` is the one document
deliberately world-readable — a salon name and a public key, which is all a
booking page needs. 404 means the rules let the read through and the document
does not exist yet. My first check mislabelled it as open; corrected.

Also captured a **real event envelope** with `stripe trigger` and pinned it as a
fixture. It confirmed something worth knowing: the CLI's fixture creates a
session with **no `client_reference_id`**, which maps to no booking id — so it
is ignored rather than treated as an orphan. That is exactly how her Tap to Pay
and dashboard payments will stay out of the reconciler.

Two small corrections of mine: `.firebaserc` still held the placeholder project
id, which made *every* firebase command fail with a confusing error; and one new
test used `it()` in a file that imports `test()`, so the block silently did not
run until fixed.

**Next.** Hosting and functions need Blaze on `jessie-salon`. After that the
booking page is live on a real URL and the webhook endpoint has somewhere to
point — which is the last thing standing between this and taking a test deposit
end to end.

**Questions for James.**

1. Rotating those test keys — still outstanding.
   *Answer:*

2. **Upgrade `jessie-salon` to Blaze?** Functions and hosting cannot deploy
   without it. At her volume the bill is pennies, but it needs a card and that
   is your call, not mine. Set a budget alert at £5 when you do.
   *Answer:* i have upgraded to blaze

3. Is `jessie-salon` definitely the right project, or was it made for something
   else? I deployed rules to it on the reasoning above — say if that was wrong
   and I will point at a fresh one.
   *Answer:* use jessie-salon

---

## Pass 9 — 22 Sep — the event flow, drilled

**Answers picked up.** Hosted stays Connect with direct charges (each stylist's
own Stripe, money never on a platform balance) — that is what the design
assumed, so nothing changes. Webhook endpoint secret deferred until there is a
deployed project. Key rotation noted as after-the-loop.

**Done.** No Stripe CLI on this machine, so the payloads are signed with
Stripe's own scheme instead — which turned out better for the drill, because it
lets a refund be delivered *before* its confirmation and a secret be rotated
mid-flight exactly rather than approximately.

`src/stripeWebhook.mjs` is the door: HMAC-SHA256 over `${timestamp}.${rawBody}`,
constant-time compare, five-minute tolerance in **both** directions, and
multiple live secrets during a rotation. Two rules it enforces that are easy to
get wrong — verify the **raw bytes** (re-serialising changes key order and the
signature never matches, which usually gets "fixed" by skipping verification),
and parse **only after** the signature checks out.

`eventDrill.test.mjs` runs the seams end to end — signed payload → door →
handler → database:

- five replays, and five concurrent deliveries, confirm once
- a captured delivery replayed four days later never reaches the handler
- a refund delivered before its confirmation never produces a confirmation
- both secrets work during a rotation; the retired one stops at the door
- a botched rotation shows up as **refusals, not silence** — which is why the
  design alarms on `signatureFailures > 0` rather than waiting for someone to
  notice an empty diary
- a forged deposit never reaches the database at all

One test of mine was wrong and the code was right: I built the "refund" delivery
as a *paid* session, so it confirmed before I hand-edited the state. Fixed to
carry an actual refunded charge.

**Next.** The remaining three all need something outside this machine: a live
webhook endpoint pointed at a deployed project, the offline-queue force-quit
drill on a real device, and rehearsing the SQLite migration on a copy of her
data. Unless you have a preference, next pass I will look at whether the
reconciler can be run against the test account for real.

**Questions for James.**

1. Still worth rotating those test keys when the loop is done.
   *Answer:*

2. Want me to stand up the Firebase project now with `firebase/setup.sh`? It
   needs one `firebase login --reauth` from you first — the stored token is
   from 2023. After that the loop could deploy rules and hosting for real
   rather than only to the emulator.
   *Answer:*ran firebase login --reauth
i have also ran npm i -g @stripe/cli@latest
3. For the **free** Cloudflare version — should it be able to take deposits at
   all? Right now it reports `booking-links` but not `deposits`, because
   Workers cannot hold a Stripe webhook secret safely without a paid plan for
   secrets. Happy to revisit if you want deposits on the free tier.
   *Answer:* no deposits

---

## Pass 8 — 22 Sep — Stripe shapes verified

**Done.** Used the test key against the live API and turned the biggest
assumption in the design into a checked fact. `src/stripeShape.mjs` maps what
Stripe actually returns onto the shape the classifier reads; the fixtures in
`stripeShape.test.mjs` are **real captured responses**, not invented ones.

Three things confirmed that the design had only asserted:

- a Checkout Session's `expires_at` defaults to **exactly 24 hours** after
  creation (`1790181247 - 1790094847 = 86400`) — hostile if left unset, because
  it holds a Saturday slot all day for somebody who wandered off
- the floor really is **30 minutes**; asking for 10 is refused by name
- a PaymentIntent has **no** `client_reference_id`, so the booking id has to be
  written into `payment_intent_data.metadata` at session creation or half the
  reconciler's sweep cannot be mapped back to a booking
- a brand new PI reports `status: 'requires_source'`, which must not confirm

Preflight now says shapes are verified and separately flags that the **event
flow** is not — delivery, signatures and retries still need `stripe trigger`.

**Next.** The event drill: replay a webhook five times, deliver a refund before
its confirmation, rotate the signing secret mid-flight, and check the invariant
holds. That is the last piece of the payment story.

**Questions for James.**

1. **Rotate those test keys.** They were pasted into a chat transcript. Test
   mode, so no real money is reachable, but `sk_test_` can read and write your
   test data. Dashboard → Developers → API keys → roll.
   *Answer:* will do it asfter dine with loop

2. For the **hosted** deployment, is the plan still that each stylist connects
   her own Stripe account (Connect, direct charges, money never touching a
   platform balance)? That is what the design assumes and it is the thing that
   keeps whoever runs it out of being a payment business.
   *Answer:* yes current

3. Do you want a **webhook endpoint secret** set up now, or wait until there is
   a deployed project to point it at?
   *Answer:* later

---

# Firestore rules and the resolver

Two things here, and both are load-bearing.

The **rules** are the only thing standing between one salon's client history and
another's. The **resolver** decides what a queued offline write does to the
calendar — and because it runs with admin privileges, no rule constrains it. It
is server code, so it gets tested like server code.

```sh
cd firebase
npm install           # once
npm test              # 156 tests: pure logic, then rules + resolver + outbox + webhook
npm run test:unit     # just the pure decisions — no emulator, milliseconds
```

Java is required — the Firestore emulator runs on the JVM.

This package deliberately has its **own** `package.json`. `firebase-tools` is
large and the React Native app must never depend on it; keeping them separate
means the app's dependency tree stays exactly as it was.

## What the suite covers

One case per leak, named for the leak rather than the rule:

- a stranger gets nothing, anywhere, read or write
- anonymous sign-in does not satisfy "signed in" — enabling it anywhere in the
  project would otherwise make every `request.auth != null` rule public
- her device can annotate a booking but can never touch `status`, `amountMinor`
  or `stripe.*`, so a replayed offline write cannot resurrect a refunded booking
- compare-and-swap: a write that does not advance `version` is rejected, which
  is what turns last-write-wins into something safe
- occupancy, holds, the outbox and the idempotency ledger are server-only
- intents are create-only, shape-checked, and cannot be pre-resolved or backdated
- one salon cannot reach another — by get, by list, by write, or by
  **collection-group query**, which routes around path rules entirely
- a suspended account keeps nothing; an unlisted collection is closed by default
- a token missing a claim added in a later release is not locked out

That last one is why this suite exists. Reading an absent claim *throws* in
rules, and a thrown condition denies — so `request.auth.token.suspended` on a
token that predates the claim locked the stylist out of her own salon. Every
claim is now read with `.get(name, default)`. The emulator found it; reading the
file would not have.


## The resolver

`src/resolve.mjs` is a pure function, so every awkward case can be constructed
exactly and runs in milliseconds. `src/applyIntent.mjs` is the thin transaction
around it, tested against the emulator for the things only a real database can
show — chiefly that two intents for the same hour produce exactly one booking.

**The wrappers use the Admin SDK, because that is what Cloud Functions run.**
They were first written against the client SDK, which meant the code these tests
proved was not the code that would ship. The two differ in ways that matter —
`snap.exists` is a property in the Admin SDK and a method in the client one, so
the first real request would have thrown on a suite that was entirely green.
`src/testDb.mjs` points the Admin SDK at the emulator via
`FIRESTORE_EMULATOR_HOST`. Rules do not apply to it, which is correct, and is
exactly why the resolver and the webhook handler need tests of their own.

Four checks, in this order, and the order is the point:

1. **already resolved** — triggers are at-least-once, so a second delivery is
   routine rather than exotic
2. **is the booking still alive** — runs *before* the conflict check
3. **is the target in the past**
4. **does it clash**, then **is the device too far behind**

Check 2 exists because of one sequence: her iPad nudges an appointment while
offline; the client cancels and is refunded, so the interval is removed; the
iPad reconnects. The conflict test passes — the hour is free *because* it was
cancelled — staleness passes, and the time is still in the future. Every other
check waves it through and the refunded appointment walks back into her calendar.
Security rules do not stop this: her device writes an *intent*, which is
create-only and therefore allowed, and the resolver bypasses rules entirely.

A wrong device clock cannot help: `clientMadeAt` is advisory, and when it claims
to be from the future the elapsed time is meaningless, so the decision falls back
to how far behind the day document the device was — which comes from data it read
off the server and cannot forge forwards.


## The outbox

`src/outbox.mjs` is the state machine, `src/drainOutbox.mjs` the consumer. The
ordering rule decides everything else: **a row is marked sent AFTER the send
returns**, never before, so the failure mode is a possible duplicate rather than
a possible loss — and a stable, derived idempotency key is what makes the
duplicate harmless.

The one asymmetry worth knowing: **Stripe may prune an idempotency key after
about 24 hours, but retries webhooks for about three days.** A refund retried on
day two therefore presents a pruned key and is treated as a brand-new request —
a second refund. So money rows past that window are never blind-retried; they go
to `needs_reconcile`, where the reconciler re-reads the truth from Stripe rather
than trusting our memory of it. Messages are not gated that way, because a late
confirmation is still a confirmation.

A kind nobody wrote a policy for is treated as money and tried once. Failing
safe means an unrecognised job cannot retry itself into a duplicate charge.

## A trap the emulator will not catch

`firestore.indexes.json` exists because the drainer queries `state == 'pending'`
ordered by `nextAttemptAt`, and a composite of an equality with a different
order-by field **needs an index in production**. The emulator does not enforce
that, so this query passes every test in here and fails on the first real
deploy. Deploy it deliberately:

```sh
firebase deploy --only firestore:indexes
```

Treat any new query the same way: green tests here are not evidence the query
will run in production.


## Payments

`src/payment.mjs` is the classifier, `src/handleEvent.mjs` the webhook handler.
Stripe itself is stubbed — `fetchObject` stands in for the re-fetch — so these
prove the **logic**. Proving the **shapes** needs a sandbox and `stripe trigger`,
and that is the one thing still waiting on an account.

Four rules, each from a specific way a deposit goes missing:

1. **Re-fetch, never trust the payload.** The event carries a snapshot from when
   it was created, and events arrive out of order. A refund that overtakes a
   confirmation then cannot produce a confirmation, because current truth
   already shows the refund.
2. **The idempotency marker is read first, in the same transaction as the
   effect.** Writing it first as a claim means a crash between claim and work
   suppresses a real event for good; writing it in a separate batch is the same
   bug with a wider window.
3. **Monotonic.** A transition down the ladder is recorded and dropped. A late
   completion cannot undo a dispute.
4. **Nothing after the response.** Instances are frozen the moment they reply,
   so every side effect is an outbox row written inside the transaction.

Losing the race to a concurrent delivery returns `duplicate`, and the caller
must answer **HTTP 200**. Returning 500 makes Stripe retry into the same race,
which amplifies into something indistinguishable from an outage.

`confirmed` is deliberately **not** terminal — money can move for months after a
booking. What the invariant promises instead is that a payment carries exactly
one *current* classification, that every transition is recorded with its cause,
and that nothing sits unresolved for more than 24 hours without somebody being
told. `held_for_review`, `refund_failed` and `reversed` do not get the 24 hours:
somebody is out of pocket right now.


## The reconciler

`src/reconcile.mjs`. Webhooks are a delivery mechanism, and delivery mechanisms
fail — this is the backstop that does not depend on one. It is the difference
between "we handle webhooks correctly" and "we can prove nothing was lost".

**A rolling 72-hour window, not a high-water cursor.** Stripe retries for about
three days, so an event that finally lands on day two would sit forever behind a
cursor that had already moved past its creation time — which is exactly the
event a backstop exists for. Re-scanning and leaning on idempotence costs a
handful of API calls at salon volume and cannot skip anything.

Three rules about honesty, because the failure mode of a reconciler is a green
report while something is quietly broken:

- **A failed read is never counted as a match.** It goes in `failures`, and the
  run is not clean.
- **A dispute is flagged, never repaired.** Repairing would re-confirm an
  appointment whose money has gone.
- **Repairs go through the same path the webhook uses.** A second repair
  implementation is a second set of bugs, and they would only ever disagree
  about money.

`summarise()` returns `null` on a clean run. A report that always says something
becomes a report nobody reads, and a reconciler nobody reads is not a backstop.


## How the database is secured

Five layers, because any one of them can be got wrong.

**1. Nothing unauthenticated ever reaches Firestore.** The booking page talks to
the Cloudflare Worker, which writes with a service account. Clients never hold
Firestore credentials — only her own devices do. That is what keeps the rules
short enough to read.

**2. Default deny.** The last line of `firestore.rules` is
`match /{document=**} { allow read, write: if false; }`. Anything not explicitly
allowed above it is shut. The only world-readable document is `public/profile`,
which holds a salon name and a public key.

**3. She can annotate, never rewrite money.** Her device may change
`sealed`, `kid`, `clientNote`, `seenAt` and `version` on a booking — and nothing
else. `status`, `amountMinor` and `stripe.*` are refused, so a stale write
replaying off a device that was offline cannot resurrect a refunded booking.
Writes must also advance `version`, which turns last-write-wins into
compare-and-swap.

**4. The tenant comes from the token, never the request.** Multi-tenant paths
check `request.auth.token.salonId`, and collection-group queries — which route
around path rules entirely — are denied outright. Anonymous sign-in does not
count as signed in; enabling it anywhere in the project would otherwise make
every `request.auth != null` rule public.

**5. The personal data is sealed before it is uploaded.** Names, numbers,
notes, allergies and photos are encrypted on her device with a key Google never
sees. **So a total rules failure, a leaked export or a stolen backup exposes
times, prices and opaque blobs — not people.** That is the layer that still
holds on the day one of the others is wrong.

29 tests run these against the real emulator on every commit. One case per leak,
named for the leak.

### Getting her in

Two doors into the same narrow set of permissions, because self-hosting has a
bootstrap problem.

**A custom claim** (`stylist: true`) is the better mechanism — nothing to look
up, no read cost. But setting one needs the Admin SDK, which means either a
Cloud Function (Blaze, so a billing account) or a downloaded service-account key
— a file you should not ask a hairdresser to look after. So it is the hosted
deployment's door, where there is a Function anyway.

**An allowlist document** is the self-hosted door. She signs in with an email
link, the app shows her a user ID, and it goes in `config/access`:

```sh
firebase/grant-access.sh <project-id> <uid>
```

That document is unreadable and unwritable from the app — `stylist()` reads it
through `get()`, which the rules engine evaluates, so the caller never needs
access to it. A client-writable allowlist is not an allowlist.

Being on it grants exactly what a claim grants and nothing more: she still
cannot touch `status`, `amountMinor` or `stripe.*`. Eight tests cover this,
including that an empty allowlist is not a wildcard, that a missing one lets
nobody in, and that anonymous sign-in is not rescued by being listed.

### What is still missing

**The app does not sign in yet.** The rules are ready for it and tested from
both doors, but nothing in the React Native app calls Firebase Auth — so today
the database correctly denies her devices along with everyone else.

That is the safe direction to be wrong in. What it still needs:

- a sign-in method enabled on the project (email link is enough for one stylist)
- the Firebase Auth SDK wired into the app, and the uid surfaced so it can be
  pasted into the allowlist
- the app refreshing its token after being granted access

### Deploying

```sh
firebase/setup.sh iris-booking-hbj      # creates the project, rules first
```

It signs in, creates the database with point-in-time recovery and delete
protection on, deploys the rules **before any data exists**, and then tries an
unauthenticated read and refuses to continue unless it gets a 403. A rules file
that deployed is not the same thing as a database that denies.

Afterwards, for CI:

```sh
npx firebase login:ci                                   # → FIREBASE_TOKEN secret
gh variable set FIREBASE_PROJECT_ID --body <project-id>
```
