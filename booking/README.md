# Booking service — setup

A link she sends to one person, carrying the times she'll offer them. They
pick one; it lands in iris. No payments yet (that's phase 2), and no client
information is ever stored in readable form.

```
booking/
  worker/    Cloudflare Worker (the API) + D1 schema
  site/      the page the client opens
```

## How a booking travels

1. iris mints a link — a 128-bit token, an opaque client reference, the
   service, and the times she's offering.
2. She sends it by text; iris writes the message, she taps send.
3. The page fetches the link and shows those times. It holds her **public
   key only**.
4. On submit, the client's name and number are sealed **in their browser**
   and posted with the slot id. The slot is claimed by a conditional
   update, so two people tapping the same time can't both get it.
5. iris pulls unseen bookings, opens them on the device, and files the
   appointment against the right client.

The server stores times and envelopes it cannot open. That property is the
whole design: if something later needs to read a booking server-side, treat
it as a decision to take deliberately, not a convenience.

---

# Setting it up on Cloudflare

About 20 minutes. You need a Cloudflare account (free) and a domain with
its nameservers pointed at Cloudflare.

## 1. Sign in

```sh
cd booking/worker
npm install -D wrangler
npx wrangler login          # opens a browser
npx wrangler whoami         # should print your account
```

## 2. Create the database

```sh
npx wrangler d1 create iris-booking
```

It prints a block ending in a `database_id`. Copy that into
`wrangler.toml`, replacing `PUT_YOUR_D1_DATABASE_ID_HERE`.

Then create the tables — **`--remote` matters**, without it you only build
a local copy:

```sh
npx wrangler d1 execute iris-booking --remote --file=./schema.sql
```

Check it took:

```sh
npx wrangler d1 execute iris-booking --remote \
  --command "SELECT name FROM sqlite_master WHERE type='table'"
```

You should see `salon`, `links`, `slots`, `bookings`.

## 3. Nothing to generate

There used to be a device key to make here. There isn't one now: the service
mints its own the first time you sign in to the setup page, keeps it, and
rotates it if you ever start over. Nothing to type, nothing to write down,
nothing to lose.

(`npx wrangler secret put DEVICE_KEY` still works if you'd rather pin one by
hand — the service accepts either. Most people should skip it.)

## 4. Deploy

The page needs its copy of the crypto library, then deploy ships both the
Worker and the site:

```sh
cp ../../node_modules/tweetnacl/nacl-fast.min.js ../site/vendor/
npx wrangler deploy
```

`wrangler.toml` deliberately sets `workers_dev = false` and
`preview_urls = false`. Those addresses bypass the sign-in you're about to
put on `/setup`, so the deploy has no public address yet — the next step
gives it one. **Don't turn them back on.**

## 5. Put it on her own domain

A client should see her name, not `workers.dev`.

In the dashboard: **Workers & Pages → iris-booking → Settings → Domains &
Routes → Add → Custom domain**, and enter something like
`book.herstudio.co.uk`. Cloudflare adds the DNS record and certificate;
it's usually live in under a minute.

Check it's alive — these two should answer without any keys:

```sh
curl -s -o /dev/null -w '%{http_code}\n' https://book.herstudio.co.uk/api/l/deadbeef
# 404 — no such link, which is correct

curl -s -o /dev/null -w '%{http_code}\n' -X POST https://book.herstudio.co.uk/api/links
# 401 — refuses without the device key, which is what you want
```

## 6. Put a login on the setup page

The setup page hands out the key her devices carry, so it stays shut until
something is checking who's asking. That something is **Cloudflare Access**,
free for up to 50 people, and it means she signs in with a code emailed to
her — no password to invent, keep or reset.

In the dashboard: **Zero Trust → Access → Applications → Add an application
→ Self-hosted**.

| Field | Value |
| --- | --- |
| Application name | `iris setup` |
| Session duration | 24 hours |
| Domain | `book.herstudio.co.uk` |
| Path | `setup` |

Add a second **Domain** row with the same hostname and path `api/setup` —
that covers the request the page makes for the code itself.

Then **Add a policy**: name it `her`, action **Allow**, and one rule —
*Include → Emails → her address*. Add yours too if you want to be able to
help. Save.

Back on the application's **Overview**, copy the **Application Audience
(AUD) Tag**. Your team domain is on **Zero Trust → Settings → Custom
Pages**, or it's the `<team>.cloudflareaccess.com` in the address bar when
you sign in. Put both in `wrangler.toml`:

```toml
[vars]
ACCESS_TEAM_DOMAIN = "yoursalon.cloudflareaccess.com"
ACCESS_AUD = "8f1c...the long hex string..."
```

Deploy again: `npx wrangler deploy`.

The Worker checks that token itself rather than trusting the header, so a
misconfigured policy or a request that skirts Access still gets nothing.
Until both values are filled in, `/setup` answers **503** and says so.

## 7. Link the app

Open **`https://book.herstudio.co.uk/setup`**. Cloudflare asks for her email,
sends a six-digit code, and then the page shows a QR straight away — there
is nothing to paste.

On the phone: **Settings → Online booking → Scan a code**. The phone makes
the salon keypair, keeps the secret half in its keychain, and registers the
public half here.

To add an iPad, use the code **inside the app** — Online booking → Link
another device — not the one from `/setup`. The app's code carries the
existing keys so both devices can read the same bookings; a second `/setup`
would make new keys and strand everything booked so far. The app checks for
that and warns you.

## 8. Starting over on a new phone

Same page, no terminal. She signs in at `/setup`, and because something is
already linked it shows what to, with **Start over on a new phone**.

That does two things: forgets the salon key so a new phone can register, and
rotates the device key so every old device — including anyone who once
photographed the code — is locked out rather than left holding a working key.

The catch, which the page says: bookings that already arrived are sealed to
the *old* phone's key. If that phone is gone, those envelopes can't be
opened. Her iPad or an iCloud restore is what saves them.

> Both QRs are credentials in a picture. Show them on your own screen, to
> your own device, and close the tab afterwards.

## 9. Your cancellation policy

The booking page shows your terms and makes the client tick to agree before the
Book button does anything. The app sends a default when it first registers —
48 hours notice, 50% inside that, the full amount inside 24 — and you can change
the wording to whatever you actually enforce.

The tick is stored beside the booking as a timestamp, never inside the sealed
envelope: if a late cancellation is ever argued about, you can see they agreed
without having to open the booking on your phone.

## 10. Check it end to end

Make a link from a client's card, open it on another phone, and book. It
should reach the app within seconds.

---

## Costs

Nothing, at her volume. Workers and D1 free tiers are orders of magnitude
above a one-chair salon — the domain (~£12/yr) is the only real bill.
Worth knowing: since September 2026, D1 free accounts **return errors**
rather than slowing down if daily limits are ever exceeded. Hers won't be
close.

## Troubleshooting

| What you see | What it means |
|---|---|
| `401` from the app | This device was unlinked — someone used **Start over** at `/setup`. Scan the new code. |
| `503` at `/setup` | `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` aren't set (step 6). The page stays shut until they are. |
| `403` at `/setup` | The request didn't come through Access. Check the policy covers both `setup` and `api/setup`, and that the AUD tag matches the app you actually protected. |
| Cloudflare never asks who you are | The Access policy is on a hostname you aren't using. It only covers the domain you named — never `*.workers.dev`, which is why both are off in `wrangler.toml`. |
| `no such table` | The schema went to the local copy. Re-run step 2 with `--remote`. |
| Page loads, times don't | The salon isn't registered — open Settings → Online booking on her phone. |
| QR scan does nothing | The scanning device needs camera permission, and the code must come from a linked device. |
| Booking arrives unreadable | The two devices hold different keypairs. Re-pair the second one by QR rather than typing. |
| `409 already set up` | Something tried to register a different salon key. Expected if you re-ran `/setup` on a second device — use the in-app code instead. If you really are starting over, use **Start over** at `/setup` (step 8). |

## Updating and rolling back

```sh
npx wrangler deploy                    # ship a change
npx wrangler deployments list          # see what's out there
npx wrangler rollback                  # go back a version
npx wrangler tail                      # live logs (no client data in them)
```

## Keeping the boundary

Three rules worth defending in review:

1. **No client information is stored in readable form.** Bookings arrive
   sealed; the server can't open them and shouldn't ever need to.
2. **The secret key never leaves her devices.** It goes phone → iPad by
   QR, never through the service, never in the database, never in a sync
   file.
3. **The salon key is write-once.** The device key alone must never be
   enough to re-key the salon — otherwise a photographed QR quietly
   redirects every future booking.

### What a leaked device key gets someone

Worth being clear-eyed, because it is the one secret that travels. With it,
someone could see booking *times*, create or revoke links, and mark
bookings as seen — a nuisance. They could **not** read any booking (that
needs the secret key, which never leaves her devices) and can **not**
re-key the salon (write-once). Rotate it from `/setup` → **Start over**,
then re-link her devices.

### Why the login goes on the setup page and not the whole site

Access covers `setup` and `api/setup` only. Everything else has to stay open:
a client following her link can't be asked to sign in to Cloudflare, and her
app carries a bearer key rather than a browser session. So the boundary is:
**the browser path that reveals a key needs a person; the API paths that use
one need the key.**
