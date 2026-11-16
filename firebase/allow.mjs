#!/usr/bin/env node
/**
 * Lets a device into her database, using the Firebase CLI's own sign-in.
 *
 *   node firebase/allow.mjs <project-id> <uid>
 *
 * The fallback grant-access.sh uses when gcloud is not installed. Same rule as
 * the script: the current allowlist is READ first and the new ID added to it —
 * a read that fails stops everything, because writing without it would replace
 * the devices already allowed in.
 */
import { firestore } from './admin.mjs';

const [project, uid] = process.argv.slice(2);
if (!project || !uid) {
  console.error('usage: node firebase/allow.mjs <project-id> <uid>');
  process.exit(1);
}

const read = await firestore(project, 'GET', 'config/access');
if (read.status !== 200 && read.status !== 404) {
  console.error(`Couldn't read the current allowlist (HTTP ${read.status}), so nothing was changed.`);
  process.exit(1);
}
const existing = read.status === 200
  ? (read.body?.fields?.uids?.arrayValue?.values ?? []).map((v) => v.stringValue).filter(Boolean)
  : [];
if (existing.includes(uid)) {
  console.log('Already allowed in.');
  process.exit(0);
}

const all = [...existing, uid];
const write = await firestore(project, 'PATCH', 'config/access?updateMask.fieldPaths=uids', {
  fields: { uids: { arrayValue: { values: all.map((u) => ({ stringValue: u })) } } },
});
if (write.status !== 200) {
  console.error(`The allowlist was not updated (HTTP ${write.status}).`);
  process.exit(1);
}
console.log(`Allowed in. ${all.length} device${all.length > 1 ? 's' : ''} on the list.`);
