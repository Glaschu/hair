/* The booking page. It holds her PUBLIC key only: details are sealed here,
   in the client's browser, and can be opened solely inside the app. */

const token = location.pathname.split('/').pop();
const view = document.getElementById('view');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let link = null;
let chosenSlot = null;
/** The salon's zone when there is no link to read it from — the return from Stripe. */
let bookingTz = null;

// Formatted in the salon's zone, never the reader's. Without this a client
// abroad books 12:00 for an 11:00 slot and both sides hold written proof they
// were right.
const zone = () => (link && link.tz) || bookingTz || 'Europe/London';
const fmtDay = (iso) => new Date(iso).toLocaleDateString('en-GB',
  { weekday: 'long', day: 'numeric', month: 'long', timeZone: zone() });
const fmtTime = (iso) => new Date(iso).toLocaleTimeString('en-GB',
  { hour: '2-digit', minute: '2-digit', timeZone: zone() });
const money = (n) => '£' + (Number(n) % 1 === 0 ? Number(n) : Number(n).toFixed(2));

/* The refund schedule as plain lines, generated from the numbers the service
   applies — shown under her words so what a client agrees to includes what will
   actually happen. Word-for-word in step with describeTiers in the app's
   src/data/policy.ts; a test checks the two agree. */
const hoursLabel = (h) => (h >= 72 && h % 24 === 0 ? `${h / 24} days` : h === 1 ? '1 hour' : `${h} hours`);
function scheduleLines(tiers, depositMinor) {
  return tiers.map((t, i) => {
    const upper = i > 0 ? tiers[i - 1].minNoticeHours : null;
    const when = upper === null
      ? (t.minNoticeHours === 0 ? 'Whenever you cancel' : `${hoursLabel(t.minNoticeHours)} or more before`)
      : t.minNoticeHours === 0
        ? `Less than ${hoursLabel(upper)} before`
        : `${hoursLabel(t.minNoticeHours)} to ${hoursLabel(upper)} before`;
    const back = t.refundPct === 100 ? 'your deposit back in full'
      : t.refundPct === 0 ? 'no refund'
      : depositMinor ? `${money(Math.round((depositMinor * t.refundPct) / 100) / 100)} back (${t.refundPct}%)`
      : `${t.refundPct}% of your deposit back`;
    return `${when}: ${back}`;
  });
}

/* --- the sealed envelope: ephemeral key ‖ nonce ‖ ciphertext --- */
function seal(plaintext, recipientPublicKeyB64) {
  const recipient = nacl.util_decodeBase64(recipientPublicKeyB64);
  const ephemeral = nacl.box.keyPair();
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const message = new TextEncoder().encode(plaintext);
  const boxed = nacl.box(message, nonce, recipient, ephemeral.secretKey);

  const out = new Uint8Array(ephemeral.publicKey.length + nonce.length + boxed.length);
  out.set(ephemeral.publicKey, 0);
  out.set(nonce, ephemeral.publicKey.length);
  out.set(boxed, ephemeral.publicKey.length + nonce.length);
  return nacl.util_encodeBase64(out);
}

/* tweetnacl ships without its util package, so base64 lives here. */
nacl.util_decodeBase64 = (b64) => {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
nacl.util_encodeBase64 = (bytes) => {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
};

async function load() {
  try {
    const res = await fetch(`/api/l/${token}`);
    if (!res.ok) return renderGone();
    link = await res.json();
    document.getElementById('salon').textContent = link.salonName;
    document.title = `Book with ${link.salonName}`;
    renderTimes();
  } catch {
    renderError("Couldn't reach the diary. Check your signal and try again.");
  }
}

function renderGone() {
  view.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:14px">
      <div class="eyebrow">This link</div>
      <h1 class="serif">These times have gone</h1>
      <p>They tend to go quickly, I'm afraid. Send me a message and I'll find you another.</p>
    </div>`;
}

function renderError(message) {
  view.innerHTML = `<div class="error">${esc(message)}</div>`;
}

function renderTimes() {
  if (!link.slots.length) return renderGone();

  const days = {};
  for (const s of link.slots) (days[fmtDay(s.startsAt)] ||= []).push(s);

  view.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:24px">
      <div style="display:flex;flex-direction:column;gap:12px">
        <div class="eyebrow">Held for you</div>
        <h1 class="serif">${link.greeting ? esc(link.greeting) + ' —<br>' : ''}here are your times</h1>
      </div>

      <div class="card" style="display:flex;align-items:center;gap:14px">
        <div style="flex:1">
          <div style="font-size:15.5px;font-weight:600">${esc(link.serviceName)}</div>
          <div style="font-size:13px;color:var(--ink2);margin-top:3px">${link.durationMins} min</div>
        </div>
        <div class="serif" style="font-size:24px">${money(link.priceMinor / 100)}</div>
        <div style="font-size:12.5px;color:var(--ink3);margin-top:2px">All times UK</div>
      </div>

      <div style="display:flex;flex-direction:column;gap:18px" id="days">
        ${Object.entries(days).map(([day, slots]) => `
          <div class="day">
            <div class="serif" style="font-size:20px">${esc(day)}</div>
            <div class="times">
              ${slots.map((s) => `
                <button class="slot" type="button" aria-pressed="false"
                        data-id="${esc(s.id)}" data-start="${esc(s.startsAt)}">
                  ${fmtTime(s.startsAt)}
                </button>`).join('')}
            </div>
          </div>`).join('')}
      </div>

      <form id="form" style="display:flex;flex-direction:column;gap:16px">
        <label><span class="eyebrow">Your name</span>
          <input name="name" autocomplete="name" required maxlength="80"></label>
        <label><span class="eyebrow">Mobile</span>
          <input name="phone" type="tel" autocomplete="tel" required maxlength="32"></label>
        <label><span class="eyebrow">Email (optional)</span>
          <input name="email" type="email" autocomplete="email" maxlength="120"></label>
        <label><span class="eyebrow">Anything I should know?</span>
          <textarea name="note" maxlength="600"
            placeholder="What you're thinking of, past colour, anything you've reacted to before…"></textarea></label>

        ${link.policy ? `
        <div class="policy">
          <div class="eyebrow" style="margin-bottom:8px">Cancellation policy</div>
          <div class="policy-text">${esc(link.policy)}</div>
          ${link.depositMinor && link.refundTiers ? `
          <ul class="policy-text" style="margin:10px 0 0;padding-left:18px">
            ${scheduleLines(link.refundTiers, link.depositMinor).map((l) => `<li>${esc(l)}</li>`).join('')}
          </ul>` : ''}
          <label class="agree">
            <input type="checkbox" name="agreed" id="agreed" required>
            <span>I've read the cancellation policy and agree to it.</span>
          </label>
        </div>` : ''}

        ${link.depositMinor ? `
        <div class="policy">
          <div class="eyebrow" style="margin-bottom:8px">Deposit</div>
          <div class="policy-text">To hold the appointment there's a deposit of
            <strong>${money(link.depositMinor / 100)}</strong>, taken now. The rest is paid in the
            salon. What you get back if you cancel is set out above.</div>
        </div>` : ''}

        <button class="primary" type="submit" disabled id="submit">Pick a time first</button>

        <div class="note">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--sage)"
               stroke-width="2" stroke-linecap="round" style="flex-shrink:0;margin-top:1px">
            <rect x="3" y="11" width="18" height="11" rx="2"></rect>
            <path d="M7 11V7a5 5 0 0110 0v4"></path></svg>
          <div><strong style="color:var(--ink)">Only ${esc(link.salonName)} can read this.</strong>
          Your details are locked on your phone before they're sent.</div>
        </div>
      </form>
    </div>`;

  const submit = document.getElementById('submit');
  view.querySelectorAll('button.slot').forEach((btn) => {
    btn.addEventListener('click', () => {
      view.querySelectorAll('button.slot').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      btn.setAttribute('aria-pressed', 'true');
      chosenSlot = { id: btn.dataset.id, startsAt: btn.dataset.start };
      submit.disabled = false;
      submit.textContent = `Book ${fmtDay(chosenSlot.startsAt)}, ${fmtTime(chosenSlot.startsAt)}`;
    });
  });

  document.getElementById('form').addEventListener('submit', onSubmit);
}

/* One per attempt at booking: the same press arriving twice is the same
   booking. A NEW one after backing out of Stripe — that attempt is over, and
   reusing its id resumed the checkout they had just abandoned. */
const newRequestId = () => (crypto.randomUUID
  ? crypto.randomUUID()
  : String(Date.now()) + Math.random().toString(36).slice(2));
let requestId = newRequestId();

async function onSubmit(event) {
  event.preventDefault();
  if (!chosenSlot) return;

  const submit = document.getElementById('submit');
  submit.disabled = true;
  submit.textContent = 'Booking…';

  const data = new FormData(event.target);
  const sealed = seal(JSON.stringify({
    name: (data.get('name') || '').trim(),
    phone: (data.get('phone') || '').trim(),
    email: (data.get('email') || '').trim() || undefined,
    note: (data.get('note') || '').trim() || undefined,
  }), link.publicKey);

  // Which path this is belongs to the DEPLOYMENT, not to the page. The free
  // Cloudflare service never reports a deposit, and the same page serves it.
  if (link.depositMinor) return startCheckout(submit, sealed, data);

  try {
    const res = await fetch(`/api/l/${token}/book`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // Recorded beside the booking rather than inside the envelope: she can
      // see they agreed without having to open the booking on her phone.
      body: JSON.stringify({
        slotId: chosenSlot.id, sealed, agreed: !!data.get('agreed'), requestId,
      }),
    });

    if (res.status === 409) {
      renderError('Someone just took that time. Pick another and try again.');
      return load();
    }
    // Deposits were switched on after this page loaded. Reload, and the page
    // offers the deposit instead of failing.
    if (res.status === 402) return load();
    if (!res.ok) throw new Error('failed');
    const done = await res.json().catch(() => ({}));
    renderBooked({
      name: data.get('name'), startsAt: chosenSlot.startsAt,
      salonName: link.salonName, cancelToken: done.cancelToken, depositMinor: null,
    });
  } catch {
    submit.disabled = false;
    submit.textContent = 'Try again';
    const box = document.createElement('div');
    box.className = 'error';
    box.textContent = "That didn't send. Check your signal and try again.";
    event.target.prepend(box);
  }
}

/**
 * Hands over to Stripe.
 *
 * The envelope goes with the request, BEFORE any money moves: the webhook that
 * confirms this arrives long after this page has closed, and there is no later
 * moment to collect a name in.
 *
 * Nothing here confirms anything. Coming back from Stripe is navigation, not
 * proof — only the signed webhook confirms, which is why the success URL grants
 * nothing on return.
 */
async function startCheckout(submit, sealed, data) {
  submit.textContent = 'Taking you to pay…';
  try {
    const res = await fetch(`/api/l/${token}/deposit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slotId: chosenSlot.id, sealed, agreed: !!data.get('agreed'), requestId,
      }),
    });

    if (res.status === 409) {
      renderError('Someone just took that time. Pick another and try again.');
      return load();
    }
    if (!res.ok) throw new Error('failed');

    const started = await res.json();
    // The same press arriving again after they had already paid: show them
    // where they stand rather than a second checkout.
    if (!started.checkoutUrl && started.cancelToken) return awaitPayment(started.cancelToken);
    if (!started.checkoutUrl) throw new Error('no url');
    // Remembered for this tab: if they come back with the browser's Back button
    // (not Stripe's own link), the page can still end that checkout and free
    // their hold — otherwise their own hold made every time look gone.
    try { sessionStorage.setItem(`iris.checkout.${token}`, started.cancelToken); } catch { /* private mode */ }
    window.location.assign(started.checkoutUrl);
  } catch {
    submit.disabled = false;
    submit.textContent = 'Try again';
    const box = document.createElement('div');
    box.className = 'error';
    // Nothing has been charged and the time is not held — say so, because the
    // one thing someone fears here is having paid into a void.
    box.textContent = "Couldn't start the payment. Nothing has been charged. Try again.";
    document.getElementById('form').prepend(box);
  }
}

function renderBooked({ name, startsAt, salonName, cancelToken, depositMinor, paid }) {
  const first = String(name || '').trim().split(' ')[0];
  view.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:22px;align-items:center;text-align:center;padding-top:20px">
      <div class="tick">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--sage)"
             stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20 6L9 17l-5-5"></path></svg>
      </div>
      <h1 class="serif" style="font-size:34px">You're in the book</h1>
      <p>${first ? esc(first) + ', y' : 'Y'}ou're down for
         <strong style="color:var(--ink)">${esc(fmtDay(startsAt))} at
         ${esc(fmtTime(startsAt))}</strong>.
         ${paid ? `Your deposit of ${money(depositMinor / 100)} has been paid. ` : ''}${salonName ? esc(salonName) + ' will text you to confirm.' : ''}</p>
      ${cancelToken ? `
      <button class="ghostlink" id="cancel" type="button">Need to cancel?</button>
      <div id="cancelbox" class="hidden" style="width:100%"></div>` : ''}
    </div>`;

  // Somewhere to cancel, from the same page, without an account. Burying this
  // behind "message the salon" is how a no-show happens instead of a cancellation
  // — and a freed hour is worth more to her than an awkward conversation avoided.
  const btn = document.getElementById('cancel');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const box = document.getElementById('cancelbox');
    btn.classList.add('hidden');
    box.classList.remove('hidden');
    box.innerHTML = '<div class="policy"><div class="policy-text">Checking…</div></div>';
    try {
      const res = await fetch(`/api/c/${cancelToken}`);
      const q = await res.json();
      // Only talk about a deposit when one was taken. A free booking has
      // nothing to come back, and saying otherwise invents a promise.
      const back = !q.depositMinor ? 'You can cancel here and the time goes back to the salon.'
                 : q.refundPct === 100 ? `Your deposit of ${money(q.depositMinor / 100)} comes back in full.`
                 : q.refundPct === 0 ? "Your deposit isn't refunded at this notice."
                 : `${money(Math.round(q.depositMinor * q.refundPct / 100) / 100)} of your deposit comes back.`;
      box.innerHTML = `
        <div class="policy">
          <div class="policy-text">${esc(back)}</div>
          <button class="primary" id="reallycancel" type="button"
                  style="margin-top:14px">Cancel my appointment</button>
        </div>`;
      document.getElementById('reallycancel').addEventListener('click', async () => {
        const done = await fetch(`/api/c/${cancelToken}`, { method: 'POST' });
        box.innerHTML = done.ok
          ? `<div class="policy"><div class="policy-text">Cancelled. Thanks for letting us know.${
              q.depositMinor && q.refundPct > 0 ? ' The refund goes back to your card within a few days.' : ''}</div></div>`
          : '<div class="error">That didn\'t go through — message the salon instead.</div>';
      });
    } catch (e) {
      box.innerHTML = '<div class="error">Couldn\'t reach the salon just now.</div>';
    }
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* The salon's name at the top. The link view fills it in; the pages that come
   back from Stripe never load the link, and showed "…" instead. */
function showSalon(name) {
  if (!name) return;
  document.getElementById('salon').textContent = name;
  document.title = `Book with ${name}`;
}

/**
 * Back from Stripe.
 *
 * The redirect proves nothing — anyone can type this URL — so the page asks the
 * SERVER to look, and the server asks Stripe. That same check is what confirms
 * the booking if the webhook is late or misconfigured, so the client coming
 * back is never left in the dark because a delivery failed somewhere.
 *
 * Never shows the booking form again: someone who has paid and sees the form
 * pays twice.
 */
async function awaitPayment(cancelToken) {
  view.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:14px;text-align:center;padding-top:20px">
      <div class="eyebrow">Payment</div>
      <h1 class="serif">Confirming your booking…</h1>
      <p>This usually takes a few seconds. Please don't pay again.</p>
    </div>`;

  for (let i = 0; i < 24; i++) {
    let q = null;
    try {
      const res = await fetch(`/api/c/${cancelToken}/check`, { method: 'POST' });
      if (res.ok) q = await res.json();
    } catch { /* offline for a moment — keep asking */ }

    if (q) {
      bookingTz = q.tz;
      showSalon(q.salonName);
      if (q.status === 'confirmed') {
        return renderBooked({
          startsAt: q.startsAt, salonName: q.salonName, cancelToken,
          depositMinor: q.depositMinor, paid: true,
        });
      }
      if (q.status === 'slot_lost') {
        view.innerHTML = `
          <div style="display:flex;flex-direction:column;gap:14px">
            <div class="eyebrow">Sorry</div>
            <h1 class="serif">That time went while you were paying</h1>
            <p>Your deposit${q.depositMinor ? ` of ${money(q.depositMinor / 100)}` : ''} is being refunded in full —
               there's nothing you need to do. ${q.salonName ? esc(q.salonName) + ' will' : 'The salon will'} be in touch to find you another time.</p>
          </div>`;
        return;
      }
      if (q.status !== 'pending_payment') {
        view.innerHTML = `
          <div style="display:flex;flex-direction:column;gap:14px">
            <h1 class="serif">This booking is no longer active</h1>
            <p>If you've been charged for it, the deposit is refunded automatically. Message the salon if anything looks wrong.</p>
          </div>`;
        return;
      }
    }
    await sleep(i < 6 ? 1500 : 4000);
  }

  // Still not confirmed after about a minute and a half. Honest, and above all
  // not an invitation to pay again.
  view.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:14px">
      <div class="eyebrow">Payment</div>
      <h1 class="serif">Your payment is still going through</h1>
      <p>Some cards take a little longer. You don't need to book or pay again — your time is
         held, and you'll get a text once it's confirmed. You can refresh this page to check.</p>
    </div>`;
}

/**
 * Back from Stripe WITHOUT paying.
 *
 * The checkout they walked away from was still holding their hour, so on a
 * one-off link every time looked gone — to the one person trying to book. The
 * server ends that checkout (so nobody can pay into it) and frees the hour,
 * then the times are shown as normal.
 */
async function backFromStripe(cancelToken) {
  let q = null;
  try {
    const res = await fetch(`/api/c/${cancelToken}/release`, { method: 'POST' });
    if (res.ok) q = await res.json();
  } catch { /* the hold lapses on its own; show the times regardless */ }

  // They may have paid in another tab before coming back here.
  if (q && q.status === 'confirmed') {
    bookingTz = q.tz;
    showSalon(q.salonName);
    return renderBooked({
      startsAt: q.startsAt, salonName: q.salonName, cancelToken,
      depositMinor: q.depositMinor, paid: true,
    });
  }
  history.replaceState(null, '', location.pathname);
  requestId = newRequestId();
  load();
}

/* A return from Stripe carries the booking's cancel token; anything else is a
   fresh visit to the link. */
const returned = new URLSearchParams(location.search);
const openCheckout = (() => {
  try {
    const c = sessionStorage.getItem(`iris.checkout.${token}`);
    sessionStorage.removeItem(`iris.checkout.${token}`);
    return c;
  } catch { return null; }
})();
if (returned.get('paid') === '1' && returned.get('c')) {
  awaitPayment(returned.get('c'));
} else if (returned.get('back') === '1' && returned.get('c')) {
  backFromStripe(returned.get('c'));
} else if (openCheckout) {
  // Back from Stripe by the browser's Back button or a reload.
  backFromStripe(openCheckout);
} else {
  load();
}
