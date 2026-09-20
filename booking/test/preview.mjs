/**
 * Serves the real page against the real Worker with a seeded link, so the
 * site can be looked at (and screenshotted) exactly as a client sees it.
 *   node booking/test/preview.mjs [port]
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { makeService, makeAccess, newSalonKeys, SITE_DIR } from './harness.mjs';

const port = Number(process.argv[2] ?? 8788);
// Access is stood up so /setup can be looked at too — this server plays the
// part Cloudflare plays in front of the real thing, and stamps every request.
const access = await makeAccess();
const accessToken = await access.token();
const { env, call, authed } = makeService({ access: true });
const keys = newSalonKeys();

const at = (days, hour, min = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, min, 0, 0);
  return d.toISOString();
};

const POLICY = [
  'If you need to cancel your appointment, please give at least 48 hours notice.',
  '',
  'Cancellations with less than 48 hours notice will be charged 50% of the remaining appointment cost. Cancellations less than 24 hours will need to pay the full amount.',
  '',
  'If you need to reschedule, please follow the same guidelines.',
].join('\n');

await authed('/api/salon', { method: 'PUT', body: JSON.stringify({ name: 'Iris', publicKey: keys.publicKey, policy: POLICY }) });
const link = await (await authed('/api/links', {
  method: 'POST',
  body: JSON.stringify({
    clientRef: 'preview', greeting: 'Sara', serviceName: 'Consultation',
    durationMins: 30, price: 45,
    slots: [
      { startsAt: at(4, 11), endsAt: at(4, 11, 30) },
      { startsAt: at(4, 15, 30), endsAt: at(4, 16) },
      { startsAt: at(6, 10), endsAt: at(6, 10, 30) },
      { startsAt: at(9, 12, 30), endsAt: at(9, 13) },
    ],
  }),
})).json();

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);

  if (url.pathname.startsWith('/api/')) {
    const body = req.method === 'POST' || req.method === 'PUT'
      ? await new Promise((r) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => r(d)); })
      : undefined;
    const out = await call(url.pathname, {
      method: req.method,
      headers: { ...req.headers, 'cf-access-jwt-assertion': accessToken },
      body,
    });
    res.writeHead(out.status, { 'content-type': out.headers.get('content-type') ?? 'application/json' });
    res.end(await out.text());
    return;
  }

  // Land on the seeded link so the preview is one click.
  if (url.pathname === '/') {
    res.writeHead(302, { location: `/b/${link.token}` });
    res.end();
    return;
  }

  // Mirror what the Worker's asset binding serves for its two pages.
  const file = url.pathname.startsWith('/b/') ? join(SITE_DIR, 'index.html')
    : url.pathname === '/setup' ? join(SITE_DIR, 'setup.html')
    : join(SITE_DIR, url.pathname);
  if (!existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
}).listen(port, () => {
  console.log(`${link.url.replace('https://book.test', `http://localhost:${port}`)}`);
});
