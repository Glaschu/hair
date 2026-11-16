# The device drill

Twenty minutes, one phone, one booking. Everything below this is covered by 519
tests; this drill covers the part only hardware can answer — whether a booking
made on the web lands in her diary **once**, and whether a real card can pay a
deposit.

Do it on the test Stripe account. Card `4242 4242 4242 4242`, any future expiry,
any CVC.

---

## Before you start

The live service should say this:

```
curl -s https://jessie-salon.web.app/api/version
```

```json
{"service":"iris-booking","api":1,
 "capabilities":["booking-links","offsite-backup","live-sync","deposits","refunds"]}
```

Deposits are advertised only when **both** the Stripe key and the webhook
signing secret are set. The webhook must be registered in Stripe first (see
`firebase/README.md`). `scripts/preflight.sh` checks that the webhook route
exists and refuses unsigned deliveries.

---

## 1 · Mint a link

In the app: **Clients → pick a client → Send booking link.** Offer two or three
slots next week.

*Watch for:* the link is one-use and expires in 21 days. If minting fails with
"already offered", another live link is holding that hour — that is the
cross-link conflict check doing its job, not a fault.

## 2 · Open it on a phone

Open the link on a phone that is **not** the one running the app — a client's
view, not hers.

*Watch for:* her salon name, the service, the price, the slots, and the
cancellation policy with its 48-hour / 24-hour tiers. The policy shown is the
one pinned to the link, not whatever is current.

## 3 · Book it

Fill in a name and a number. Tick the policy. Book.

*Watch for:* the slot disappears from the page for anyone else the moment it is
taken. Going back and booking the same slot again should say **taken**, not
double-book.

## 4 · Pay the deposit

If the page offers a deposit, pay it with `4242…`.

**This is the step most likely to fail, and here is how to read it:**

| What you see | What it means |
|---|---|
| Stripe checkout opens; after paying, the page says "You're in the book" | Everything works: payment, confirmation, slot taken. |
| "Couldn't start the payment" | The key **lacks a scope**. A restricted key (`rk_test_…`) only does what its scopes allow: it needs Checkout Sessions write, PaymentIntents and Charges read, Refunds write. Or use the standard `sk_test_…` key. |
| "Confirming your booking…" and then "still going through" | The payment happened but could not be confirmed. Check Stripe → Developers → Webhooks for failed deliveries, and that the key can read PaymentIntents. |
| No deposit offered at all | The webhook secret isn't set, so deposits are deliberately off. |

To swap the key:

```
cd firebase
npx firebase functions:secrets:set STRIPE_SECRET_KEY   # paste at the prompt, never into a file
npx firebase deploy --only functions
```

*Watch for:* coming back from Stripe doesn't confirm the booking by itself. The
page asks the server, and the server asks Stripe. Try it: open the return URL
without paying and it must stay on "Confirming…", never "You're in the book".

Then **cancel it from the same page** with more than 48 hours' notice. Within
about five minutes the full deposit should show as refunded in Stripe, once.

Also check Stripe → Developers → Webhooks: the deliveries should show 200s.

## 5 · Pull it into the diary

On her phone, open **Today** and pull down.

*Watch for:*

- the appointment appears, at the right time, with the client's name
- the note they typed is on it
- **pull down again — nothing should duplicate.** This is the whole point of
  the drill. The local id is derived from the booking id, so a second delivery
  collides with itself.

## 6 · Pull with the phone in flight mode

Turn off the network, pull down.

*Watch for:* "Could not check for bookings — pull down again." Nothing lost,
nothing half-written. Turn the network back on, pull again, and the booking is
still there exactly once.

---

## The one that matters most

Between step 3 and step 5, **force-quit the app mid-pull** (swipe it away while
the spinner is going), then reopen and pull again.

The booking must still be in the diary exactly once. The ordering is built for
this: the diary is written before the service is told, so a kill in the middle
costs a duplicate *delivery* — which is recognised — and never a lost booking.

This is one of the three items `preflight.sh` lists as needing a human. Doing it
once here retires it.

---

## If something looks wrong

Nothing in this drill can lose a booking, so there is no need to rush a fix.
Anything not acknowledged to the service is offered again on the next pull.
Write down what you saw and at which step.
