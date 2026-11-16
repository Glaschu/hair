import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment, assertFails, assertSucceeds,
} from '@firebase/rules-unit-testing';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection,
  getDocs, query, where, collectionGroup, serverTimestamp,
} from 'firebase/firestore';

/**
 * These tests exist because the rules file is the only thing standing between
 * one salon's client history and another's, and a rule that has never been
 * executed is a comment.
 *
 * Every case is named for the leak it prevents, not the rule it exercises.
 */

let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'iris-rules-test',
    firestore: {
      rules: readFileSync(new URL('./firestore.rules', import.meta.url), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

after(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

/** Her own phone: signed in, claim present, real provider. */
const hers = () => env.authenticatedContext('stylist-1', {
  stylist: true, firebase: { sign_in_provider: 'password' },
}).firestore();

/** A stranger with no credentials at all. */
const nobody = () => env.unauthenticatedContext().firestore();

/** Signed in, but anonymously — the provider that quietly makes rules public. */
const anon = () => env.authenticatedContext('ghost', {
  stylist: true, firebase: { sign_in_provider: 'anonymous' },
}).firestore();

/** A tenant in the multi-salon deployment. */
const salon = (sid, uid = `u-${sid}`) => env.authenticatedContext(uid, {
  salonId: sid, firebase: { sign_in_provider: 'password' },
}).firestore();

/** Writes that bypass rules, the way the resolver and the Worker do. */
const asServer = (fn) => env.withSecurityRulesDisabled((ctx) => fn(ctx.firestore()));

const intent = (over = {}) => ({
  op: 'book',
  target: { s: 1759482000000, e: 1759489200000 },
  payload: { sealed: 'x'.repeat(200) },
  basisVersion: 41,
  date: '2026-10-03',
  clientMadeAt: 1759471200000,
  serverReceivedAt: serverTimestamp(),
  result: null,
  ...over,
});

describe('a stranger gets nothing', () => {
  test('cannot read or write any collection', async () => {
    const db = nobody();
    for (const path of ['bookings/b1', 'clients/c1', 'days/2026-10-03',
                        'holds/h1', 'outbox/o1', 'payments/p1', 'intents/i1']) {
      await assertFails(getDoc(doc(db, path)));
      await assertFails(setDoc(doc(db, path), { anything: true }));
    }
  });

  test('can read the public profile, because a booking page needs a name and a key', async () => {
    await asServer((db) => setDoc(doc(db, 'public/profile'), {
      salonName: 'Iris', publicKey: 'base64...', policyHash: 'abc',
    }));
    await assertSucceeds(getDoc(doc(nobody(), 'public/profile')));
  });

  test('cannot write the public profile', async () => {
    await assertFails(setDoc(doc(nobody(), 'public/profile'), { salonName: 'Not Iris' }));
  });
});

describe('anonymous sign-in does not count as signed in', () => {
  test('a ghost with the right claim still gets nothing', async () => {
    // Enabling anonymous auth anywhere in the project would otherwise turn every
    // `request.auth != null` rule into a public one.
    await asServer((db) => setDoc(doc(db, 'bookings/b1'), { status: 'confirmed', version: 0 }));
    await assertFails(getDoc(doc(anon(), 'bookings/b1')));
    await assertFails(getDoc(doc(anon(), 'clients/c1')));
  });
});

describe('her device cannot rewrite money or status', () => {
  beforeEach(async () => {
    await asServer((db) => setDoc(doc(db, 'bookings/b1'), {
      status: 'refunded', amountMinor: 4500, stripe: { paymentIntentId: 'pi_1' },
      sealed: 'blob', kid: 1, clientNote: '', seenAt: null, version: 3,
    }));
  });

  test('she can annotate a booking', async () => {
    await assertSucceeds(updateDoc(doc(hers(), 'bookings/b1'), {
      clientNote: 'came in with a box dye', version: 4,
    }));
  });

  for (const field of ['status', 'amountMinor', 'stripe']) {
    test(`she cannot touch ${field} — a stale replay must not resurrect a refunded booking`, async () => {
      const value = field === 'stripe' ? { paymentIntentId: 'pi_evil' }
                  : field === 'status' ? 'confirmed' : 9999;
      await assertFails(updateDoc(doc(hers(), 'bookings/b1'), { [field]: value, version: 4 }));
    });
  }

  test('she cannot create or delete a booking — only a paid webhook does that', async () => {
    await assertFails(setDoc(doc(hers(), 'bookings/b2'), { status: 'confirmed', version: 0 }));
    await assertFails(deleteDoc(doc(hers(), 'bookings/b1')));
  });

  test('a write that does not advance the version is rejected', async () => {
    // This is the compare-and-swap: a queued offline write replaying after the
    // server moved on carries a stale version and loses, instead of quietly
    // winning.
    await assertFails(updateDoc(doc(hers(), 'bookings/b1'), { clientNote: 'stale', version: 3 }));
    await assertFails(updateDoc(doc(hers(), 'bookings/b1'), { clientNote: 'ancient', version: 2 }));
    await assertSucceeds(updateDoc(doc(hers(), 'bookings/b1'), { clientNote: 'fresh', version: 4 }));
  });
});

describe('occupancy is server-owned', () => {
  test('she may read the day but never write it', async () => {
    await asServer((db) => setDoc(doc(db, 'days/2026-10-03'), { version: 1, intervals: [] }));
    await assertSucceeds(getDoc(doc(hers(), 'days/2026-10-03')));
    await assertFails(updateDoc(doc(hers(), 'days/2026-10-03'), { version: 2, intervals: [] }));
  });

  test('holds, outbox and the idempotency ledger are closed to her entirely', async () => {
    const db = hers();
    await assertFails(setDoc(doc(db, 'holds/h1'), { slotId: 's1' }));
    await assertFails(setDoc(doc(db, 'outbox/o1'), { kind: 'confirm' }));
    await assertFails(setDoc(doc(db, 'processedEvents/evt_1'), { at: 1 }));
    await assertFails(getDoc(doc(db, 'processedEvents/evt_1')));
  });
});

describe('intents are proposals, not writes', () => {
  test('she can propose one', async () => {
    await assertSucceeds(addDoc(collection(hers(), 'intents'), intent()));
  });

  test('a pre-resolved intent is refused — she cannot decide her own conflict', async () => {
    await assertFails(addDoc(collection(hers(), 'intents'), intent({ result: 'applied' })));
  });

  test('an intent cannot be edited or deleted once written', async () => {
    await asServer((db) => setDoc(doc(db, 'intents/i1'), { op: 'book', result: 'rejected' }));
    await assertFails(updateDoc(doc(hers(), 'intents/i1'), { result: 'applied' }));
    await assertFails(deleteDoc(doc(hers(), 'intents/i1')));
  });

  test('a backwards interval is refused, or the overlap check compares nonsense', async () => {
    await assertFails(addDoc(collection(hers(), 'intents'),
      intent({ target: { s: 1759489200000, e: 1759482000000 } })));
  });

  test('an oversized envelope is refused rather than stored', async () => {
    await assertFails(addDoc(collection(hers(), 'intents'),
      intent({ payload: { sealed: 'x'.repeat(5000) } })));
  });

  test('an unknown op is refused', async () => {
    await assertFails(addDoc(collection(hers(), 'intents'), intent({ op: 'delete_everything' })));
  });

  test('a client clock cannot forge the arrival time', async () => {
    // serverReceivedAt must be request.time. Without this, a device three days
    // dark could backdate itself and skip the staleness test.
    await assertFails(addDoc(collection(hers(), 'intents'),
      intent({ serverReceivedAt: 1759471200000 })));
  });

  test('extra fields are refused, so nothing rides along unnoticed', async () => {
    await assertFails(addDoc(collection(hers(), 'intents'), intent({ isAdmin: true })));
  });
});

describe('one salon cannot reach another', () => {
  beforeEach(async () => {
    await asServer(async (db) => {
      await setDoc(doc(db, 'salons/salon-a/bookings/b1'),
        { salonId: 'salon-a', status: 'confirmed', sealed: 'a', version: 0 });
      await setDoc(doc(db, 'salons/salon-b/bookings/b1'),
        { salonId: 'salon-b', status: 'confirmed', sealed: 'b', version: 0 });
      await setDoc(doc(db, 'salons/salon-a/clients/c1'), { salonId: 'salon-a', version: 0 });
      await setDoc(doc(db, 'salons/salon-b/clients/c1'), { salonId: 'salon-b', version: 0 });
    });
  });

  test('A can read its own', async () => {
    await assertSucceeds(getDoc(doc(salon('salon-a'), 'salons/salon-a/bookings/b1')));
  });

  test("A cannot read B's — get, list or write", async () => {
    const a = salon('salon-a');
    await assertFails(getDoc(doc(a, 'salons/salon-b/bookings/b1')));
    await assertFails(getDocs(collection(a, 'salons/salon-b/bookings')));
    await assertFails(updateDoc(doc(a, 'salons/salon-b/bookings/b1'),
      { clientNote: 'mine now', version: 1 }));
    await assertFails(getDoc(doc(a, 'salons/salon-b/clients/c1')));
  });

  test('a collection-group query cannot route around the tenant boundary', async () => {
    // This is the leak that path rules do NOT cover: a group query is evaluated
    // against wildcard rules, so without an explicit deny one query returns
    // every salon's clients.
    const a = salon('salon-a');
    await assertFails(getDocs(collectionGroup(a, 'clients')));
    await assertFails(getDocs(collectionGroup(a, 'bookings')));
    await assertFails(getDocs(query(collectionGroup(a, 'clients'),
      where('salonId', '==', 'salon-a'))));
  });

  test('a forged salonId claim is not a key to that salon', async () => {
    // The claim is what the rules trust, so this is really a test that a token
    // must be issued, not asserted. A user who signs up and hands themselves
    // salon-b in the request body gets nothing.
    const liar = env.authenticatedContext('u-a', {
      salonId: 'salon-a', firebase: { sign_in_provider: 'password' },
    }).firestore();
    await assertFails(setDoc(doc(liar, 'salons/salon-b/clients/c2'),
      { salonId: 'salon-b', version: 0 }));
  });

  test('a mislabelled document cannot be created even inside her own salon', async () => {
    const a = salon('salon-a');
    await assertFails(addDoc(collection(a, 'salons/salon-a/intents'),
      intent({ salonId: 'salon-b' })));
  });

  test('a suspended account keeps nothing', async () => {
    const suspended = env.authenticatedContext('u-a', {
      salonId: 'salon-a', suspended: true, firebase: { sign_in_provider: 'password' },
    }).firestore();
    await assertFails(getDoc(doc(suspended, 'salons/salon-a/bookings/b1')));
  });

  test('an unlisted collection inside a tenant is closed by default', async () => {
    // The trap is a new collection added later that nobody wrote a rule for.
    await asServer((db) => setDoc(doc(db, 'salons/salon-a/invoices/i1'), { total: 100 }));
    await assertFails(getDoc(doc(salon('salon-a'), 'salons/salon-a/invoices/i1')));
  });
});

describe('a missing claim locks nobody out', () => {
  test('a stylist whose token predates a claim we added later still gets in', async () => {
    // Reading `token.suspended` directly THROWS when the claim is absent, and a
    // thrown condition denies — so adding a claim in a later release would have
    // locked out every device still holding an older token, until it happened to
    // refresh. Found by the emulator, not by reading the rules.
    await env.withSecurityRulesDisabled((ctx) =>
      setDoc(doc(ctx.firestore(), 'salons/salon-a/bookings/b1'),
        { status: 'confirmed', version: 0 }));

    const older = env.authenticatedContext('u-a', {
      salonId: 'salon-a', firebase: { sign_in_provider: 'password' },
    }).firestore();
    await assertSucceeds(getDoc(doc(older, 'salons/salon-a/bookings/b1')));
  });

  test('a token with no claims at all still gets nothing', async () => {
    const bare = env.authenticatedContext('nobody-special', {
      firebase: { sign_in_provider: 'password' },
    }).firestore();
    await assertFails(getDoc(doc(bare, 'bookings/b1')));
    await assertFails(getDoc(doc(bare, 'salons/salon-a/bookings/b1')));
  });
});

describe('getting her in without a service-account key', () => {
  /**
   * The self-hosting bootstrap: she signs in with an email link, and her uid
   * goes in an allowlist document. No Cloud Function, no downloaded key, no
   * secret leaving the project.
   */
  const allow = (uids) => env.withSecurityRulesDisabled((ctx) =>
    setDoc(doc(ctx.firestore(), 'config/access'), { uids }));

  const signedInAs = (uid) => env.authenticatedContext(uid, {
    firebase: { sign_in_provider: 'emailLink' },
  }).firestore();

  beforeEach(async () => {
    await env.withSecurityRulesDisabled((ctx) =>
      setDoc(doc(ctx.firestore(), 'bookings/b1'),
        { status: 'confirmed', sealed: 'x', version: 0 }));
  });

  test('an allowlisted uid gets in with no custom claim at all', async () => {
    await allow(['her-phone-uid']);
    await assertSucceeds(getDoc(doc(signedInAs('her-phone-uid'), 'bookings/b1')));
  });

  test('a signed-in stranger does not', async () => {
    await allow(['her-phone-uid']);
    await assertFails(getDoc(doc(signedInAs('someone-else'), 'bookings/b1')));
  });

  test('with no allowlist at all, nobody is in', async () => {
    // The state a fresh project is in. Failing shut is the right direction to
    // be wrong in.
    await assertFails(getDoc(doc(signedInAs('her-phone-uid'), 'bookings/b1')));
  });

  test('an empty allowlist is not a wildcard', async () => {
    await allow([]);
    await assertFails(getDoc(doc(signedInAs('her-phone-uid'), 'bookings/b1')));
  });

  test('the allowlist cannot be read or written by anyone signed in', async () => {
    // A client-writable allowlist is not an allowlist. `stylist()` reads it via
    // get(), which the rules engine evaluates — the caller never needs access.
    await allow(['her-phone-uid']);
    const her = signedInAs('her-phone-uid');
    await assertFails(getDoc(doc(her, 'config/access')));
    await assertFails(setDoc(doc(her, 'config/access'), { uids: ['her-phone-uid', 'a-friend'] }));
  });

  test('being on the allowlist does not make her an admin', async () => {
    // It grants the same narrow shape a claim would. She still cannot rewrite
    // money or status.
    await allow(['her-phone-uid']);
    const her = signedInAs('her-phone-uid');
    await assertFails(updateDoc(doc(her, 'bookings/b1'), { status: 'cancelled', version: 1 }));
    await assertSucceeds(updateDoc(doc(her, 'bookings/b1'), { clientNote: 'box dye', version: 1 }));
  });

  test('an anonymous sign-in is not rescued by the allowlist', async () => {
    await allow(['ghost']);
    const ghost = env.authenticatedContext('ghost', {
      firebase: { sign_in_provider: 'anonymous' },
    }).firestore();
    await assertFails(getDoc(doc(ghost, 'bookings/b1')));
  });

  test('the claim still works, for the deployment that can set one', async () => {
    // Hosted has a Function to set it; self-hosted does not. Both doors, one
    // set of permissions behind them.
    await assertSucceeds(getDoc(doc(hers(), 'bookings/b1')));
  });
});

describe('marking a booking seen', () => {
  /**
   * The inbox drains through this one write, and it is the write most likely to
   * be silently impossible: `version + 1` does not evaluate to 1 on a document
   * with no version, it ERRORS, and an erroring rule denies. A booking created
   * without a version is therefore one she can never clear — it redelivers to
   * her diary forever, and nothing anywhere reports a fault.
   */
  const confirmed = (extra = {}) => ({ token: 't1', status: 'confirmed', seenAt: null, ...extra });

  test('a booking with no version can never be cleared, at any bump', async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), 'bookings/b1'), confirmed());
    });
    await assertFails(updateDoc(doc(hers(), 'bookings/b1'), { seenAt: 1 }));
    await assertFails(updateDoc(doc(hers(), 'bookings/b1'), { seenAt: 1, version: 1 }));
  });

  test('a versioned booking clears with the bump', async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), 'bookings/b2'), confirmed({ version: 0 }));
    });
    await assertSucceeds(updateDoc(doc(hers(), 'bookings/b2'), { seenAt: 1, version: 1 }));
  });

  test('clearing without bumping is refused, so a stale replay cannot land', async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), 'bookings/b3'), confirmed({ version: 4 }));
    });
    await assertFails(updateDoc(doc(hers(), 'bookings/b3'), { seenAt: 1 }));
  });

  test('un-seeing WITH a bump is allowed, and is safe', async () => {
    // Not a hole: putting a booking back in the inbox only makes it redeliver,
    // and intake recognises the appointment it already wrote. Worth pinning as
    // deliberate, because it looks like one at a glance.
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), 'bookings/b5'), confirmed({ version: 4, seenAt: 99 }));
    });
    await assertSucceeds(updateDoc(doc(hers(), 'bookings/b5'), { seenAt: null, version: 5 }));
  });

  test('marking seen can never be used to smuggle a status change', async () => {
    // The field list is the guard: money and status stay out of her reach, so
    // a refunded booking cannot come back to life via the inbox.
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), 'bookings/b4'), confirmed({ version: 0, status: 'refunded' }));
    });
    await assertFails(updateDoc(doc(hers(), 'bookings/b4'), {
      seenAt: 1, version: 1, status: 'confirmed',
    }));
  });
});

