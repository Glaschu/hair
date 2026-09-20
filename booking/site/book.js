/* The booking page. It holds her PUBLIC key only: details are sealed here,
   in the client's browser, and can be opened solely inside the app. */

const token = location.pathname.split('/').pop();
const view = document.getElementById('view');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let link = null;
let chosenSlot = null;

const fmtDay = (iso) => new Date(iso).toLocaleDateString('en-GB',
  { weekday: 'long', day: 'numeric', month: 'long' });
const fmtTime = (iso) => new Date(iso).toLocaleTimeString('en-GB',
  { hour: '2-digit', minute: '2-digit' });
const money = (n) => '£' + (Number(n) % 1 === 0 ? Number(n) : Number(n).toFixed(2));

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
        <div class="serif" style="font-size:24px">${money(link.price)}</div>
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
          <label class="agree">
            <input type="checkbox" name="agreed" id="agreed" required>
            <span>I've read the cancellation policy and agree to it.</span>
          </label>
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

  try {
    const res = await fetch(`/api/l/${token}/book`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // Recorded beside the booking rather than inside the envelope: she can
      // see they agreed without having to open the booking on her phone.
      body: JSON.stringify({ slotId: chosenSlot.id, sealed, agreed: !!data.get('agreed') }),
    });

    if (res.status === 409) {
      renderError('Someone just took that time. Pick another and try again.');
      return load();
    }
    if (!res.ok) throw new Error('failed');
    renderBooked(data.get('name'));
  } catch {
    submit.disabled = false;
    submit.textContent = 'Try again';
    const box = document.createElement('div');
    box.className = 'error';
    box.textContent = "That didn't send. Check your signal and try again.";
    event.target.prepend(box);
  }
}

function renderBooked(name) {
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
         <strong style="color:var(--ink)">${esc(fmtDay(chosenSlot.startsAt))} at
         ${esc(fmtTime(chosenSlot.startsAt))}</strong>.
         ${esc(link.salonName)} will text you to confirm.</p>
    </div>`;
}

load();
