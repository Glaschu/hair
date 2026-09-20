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
