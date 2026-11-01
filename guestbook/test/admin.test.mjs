import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, describe, test } from 'node:test';
import { ADMIN, AUD, NOTIFY_TO, OWNER, SITE, TEAM, day, note, startFixture } from './fixture.mjs';

let f;
before(async () => { f = await startFixture(); });
after(async () => { await f.mf.dispose(); });
beforeEach(async () => { await f.reset(); });

const base64url = value => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
const claims = () => {
  const now = Math.floor(Date.now() / 1000);
  return { email: OWNER, iss: 'https://' + TEAM, aud: AUD, iat: now, exp: now + 300 };
};

describe('access control', () => {
  test('every path is closed without an Access token', async () => {
    for (const pathname of ['/', '/app.js', '/api/summary', '/api/entries']) {
      assert.equal((await f.admin(pathname, { jwt: null })).status, 403, pathname);
    }
    const entry = await f.insert({});
    assert.equal((await f.admin('/api/entries/' + entry.id + '/approve', { method: 'POST', body: {}, jwt: null })).status, 403);
    assert.equal((await f.rows())[0].status, 'pending');
  });

  test('rejects forged, misdirected, expired and unlisted tokens', async () => {
    const forged = [
      ['wrong audience', await f.token({}, { audience: 'another-app' })],
      ['wrong issuer', await f.token({}, { issuer: 'https://evil.cloudflareaccess.com' })],
      ['expired', await f.token({}, { expires: Math.floor(Date.now() / 1000) - 120 })],
      ['no expiry', await f.token({}, { expires: null })],
      ['signed by another key', await f.token({}, { key: f.strangerKey })],
      ['unknown key id', await f.token({}, { kid: 'key-2' })],
      ['email not allowed', await f.token({ email: 'stranger@example.com' })],
      ['no email', await f.token({ email: undefined })],
      ['alg none', base64url({ alg: 'none', typ: 'JWT' }) + '.' + base64url(claims()) + '.'],
      ['HS256 with a guessable secret', (() => {
        const head = base64url({ alg: 'HS256', kid: 'key-1' }) + '.' + base64url(claims());
        return head + '.' + createHmac('sha256', 'key-1').update(head).digest('base64url');
      })()],
      ['garbage', 'not-a-token']
    ];
    for (const [label, jwt] of forged) {
      assert.equal((await f.admin('/api/summary', { jwt })).status, 403, label);
    }
  });

  test('accepts a valid token for an allow-listed email in any letter case', async () => {
    const response = await f.admin('/api/summary', { jwt: await f.token({ email: 'OWNER@example.com' }) });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).user, 'owner@example.com');
  });

  test('answers only on the admin origin, even with a valid token', async () => {
    const response = await f.adminDirect('https://169373219.workers.dev/api/summary', { headers: { 'Cf-Access-Jwt-Assertion': await f.token() } });
    assert.equal(response.status, 404);
  });

  test('state changes need a same-origin JSON request', async () => {
    const entry = await f.insert({});
    const approve = '/api/entries/' + entry.id + '/approve';
    assert.equal((await f.admin(approve, { method: 'POST', body: {}, origin: null })).status, 403);
    assert.equal((await f.admin(approve, { method: 'POST', body: {}, origin: SITE })).status, 403, 'another g3rry.com origin is still a different site');
    assert.equal((await f.admin(approve, { method: 'POST', body: {}, headers: { 'Sec-Fetch-Site': 'same-site' } })).status, 403);
    assert.equal((await f.admin(approve, { method: 'POST', body: '{}', headers: { 'Content-Type': 'text/plain' } })).status, 415);
    assert.equal((await f.rows())[0].status, 'pending');
  });
});

describe('admin page', () => {
  test('is served with a strict policy and never cached', async () => {
    const response = await f.admin('/');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
    const policy = response.headers.get('content-security-policy');
    for (const part of ["default-src 'none'", "script-src 'self'", "frame-ancestors 'none'", "require-trusted-types-for 'script'", "trusted-types 'none'"]) assert(policy.includes(part), part);
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(await response.text(), /<title>/);
    assert.equal((await f.admin('/app.js')).headers.get('content-type'), 'text/javascript; charset=utf-8');
  });

  test('page script never builds HTML from strings', async () => {
    const script = await readFile(new URL('../src/admin-ui/app.js', import.meta.url), 'utf8');
    assert.doesNotMatch(script, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/);
  });
});

describe('moderation', () => {
  test('a note goes from pending to public to hidden, with an audit trail', async () => {
    assert.equal((await f.submit(note(), { ip: '203.0.113.50', cf: { country: 'CA' } })).status, 202);
    let summary = await (await f.admin('/api/summary')).json();
    assert.deepEqual(summary.counts, { pending: 1, approved: 0, hidden: 0 });
    const pending = await (await f.admin('/api/entries?view=pending')).json();
    const [entry] = pending.entries;
    assert.equal(entry.name, 'Ada');
    assert.equal(entry.country, 'CA');
    assert.equal(entry.ip, (await f.hash('203.0.113.50')).slice(0, 8));
    assert.equal(entry.ipCount, 1);
    assert.equal(entry.banned, false);

    assert.equal((await f.admin('/api/entries/' + entry.id + '/approve', { method: 'POST', body: {} })).status, 200);
    assert.deepEqual((await (await f.list()).json()).entries.map(item => item.name), ['Ada']);

    const reply = await f.admin('/api/entries/' + entry.id + '/reply', { method: 'POST', body: { reply: '  Thank you!\u202E  ' } });
    assert.deepEqual(await reply.json(), { ok: true, reply: 'Thank you!' });
    await f.mf.purgeCache();
    assert.equal((await (await f.list()).json()).entries[0].reply.message, 'Thank you!');

    assert.equal((await f.admin('/api/entries/' + entry.id + '/reject', { method: 'POST', body: {} })).status, 200);
    await f.mf.purgeCache();
    assert.equal((await (await f.list()).json()).entries.length, 0);
    summary = await (await f.admin('/api/summary')).json();
    assert.deepEqual(summary.counts, { pending: 0, approved: 0, hidden: 1 });

    const audit = await f.rows('SELECT actor, action, entry_id FROM audit ORDER BY id');
    assert.deepEqual(audit.map(row => row.action), ['approve', 'reply', 'reject']);
    assert(audit.every(row => row.actor === OWNER && row.entry_id === entry.id));
  });

  test('spam with a ban silently drops later notes from the same address', async () => {
    assert.equal((await f.submit(note({ message: 'Buy now' }), { ip: '203.0.113.60' })).status, 202);
    const [entry] = await f.rows();
    assert.equal((await f.admin('/api/entries/' + entry.id + '/spam', { method: 'POST', body: { ban: true } })).status, 200);
    const [ban] = await f.rows('SELECT * FROM bans');
    assert.equal(ban.ip_hash, entry.ip_hash);
    assert(ban.until > Date.now() + 29 * day);
    assert.equal((await f.submit(note({ message: 'Buy again' }), { ip: '203.0.113.60' })).status, 202);
    assert.equal((await f.rows()).length, 1);
    const hidden = await (await f.admin('/api/entries?view=hidden')).json();
    assert.equal(hidden.entries[0].banned, true);
  });

  test('delete removes the note for good', async () => {
    const entry = await f.insert({ status: 'approved' });
    assert.equal((await f.admin('/api/entries/' + entry.id + '/delete', { method: 'POST', body: {} })).status, 200);
    assert.equal((await f.rows()).length, 0);
  });

  test('rejects malformed moderation requests', async () => {
    const entry = await f.insert({ status: 'approved' });
    const post = (pathname, body) => f.admin(pathname, { method: 'POST', body });
    assert.equal((await post('/api/entries/' + 'f'.repeat(32) + '/approve', {})).status, 404);
    assert.equal((await post('/api/entries/not-an-id/approve', {})).status, 404);
    assert.equal((await post('/api/entries/' + entry.id + '/publish', {})).status, 404);
    assert.equal((await post('/api/entries/' + entry.id + '/approve', { status: 'approved' })).status, 400);
    assert.equal((await post('/api/entries/' + entry.id + '/spam', { ban: 'yes' })).status, 400);
    assert.equal((await post('/api/entries/' + entry.id + '/reply', { reply: 'z'.repeat(1001) })).status, 422);
    assert.equal((await post('/api/entries/' + entry.id + '/reply', { reply: 42 })).status, 422);
    assert.equal((await f.admin('/api/entries?view=all')).status, 400);
    assert.equal((await f.admin('/api/entries?cursor=1')).status, 400);
    assert.equal((await f.rows())[0].status, 'approved');
  });

  test('closing submissions stops the public form', async () => {
    const response = await f.admin('/api/settings', { method: 'POST', body: { open: false } });
    assert.deepEqual(await response.json(), { ok: true, open: false });
    assert.equal((await f.submit(note())).status, 503);
    assert.equal((await f.admin('/api/settings', { method: 'POST', body: { open: 'no' } })).status, 400);
    await f.admin('/api/settings', { method: 'POST', body: { open: true } });
    assert.equal((await f.submit(note())).status, 202);
  });
});

describe('scheduled work', () => {
  test('purges address hashes, hidden notes, bans and old audit rows on time', async () => {
    const now = Date.now();
    const old = await f.insert({ status: 'approved', created_at: now - 31 * day, ip_hash: 'a'.repeat(32), country: 'US' });
    const recent = await f.insert({ status: 'approved', created_at: now - 2 * day, ip_hash: 'b'.repeat(32), country: 'US' });
    await f.insert({ status: 'rejected', created_at: now - 40 * day, reviewed_at: now - 31 * day });
    const keptHidden = await f.insert({ status: 'spam', created_at: now - 40 * day, reviewed_at: now - 3 * day });
    await f.db.prepare('INSERT INTO bans (ip_hash, until, created_at) VALUES (?, ?, ?), (?, ?, ?)').bind('c'.repeat(32), now - 1, now - day, 'd'.repeat(32), now + day, now).run();
    await f.db.prepare('INSERT INTO audit (at, actor, action) VALUES (?, ?, ?), (?, ?, ?)').bind(now - 181 * day, OWNER, 'approve', now - day, OWNER, 'reject').run();
    await f.scheduled(now);
    const rows = await f.rows('SELECT id, ip_hash, country FROM entries ORDER BY created_at');
    assert.deepEqual(rows.map(row => row.id).sort(), [old.id, recent.id, keptHidden.id].sort());
    assert.deepEqual(rows.find(row => row.id === old.id), { id: old.id, ip_hash: null, country: null });
    assert.equal(rows.find(row => row.id === recent.id).ip_hash, 'b'.repeat(32));
    assert.deepEqual((await f.rows('SELECT ip_hash FROM bans')).map(row => row.ip_hash), ['d'.repeat(32)]);
    assert.deepEqual((await f.rows('SELECT action FROM audit')).map(row => row.action), ['reject']);
  });

  test('emails one digest for new notes and none when nothing is new', async () => {
    await f.insert({ name: 'First', body: 'Hello from the first visitor', created_at: Date.now() - 2000 });
    await f.insert({ name: 'Second', body: 'Another hello', flags: 'link', created_at: Date.now() - 1000 });
    await f.scheduled();
    await new Promise(resolve => setTimeout(resolve, 300));
    const mails = f.logs.filter(line => line.includes('send_email binding called'));
    assert.equal(mails.length, 1);
    assert.match(mails[0], new RegExp('To: ' + NOTIFY_TO));
    assert.match(mails[0], /Subject: Guestbook: 2 new notes/);
    const textPath = /Text: (.+)/.exec(mails[0])[1].trim();
    const text = await readFile(textPath, 'utf8');
    assert.match(text, /2 new notes are waiting for review/);
    assert.match(text, /First/);
    assert.match(text, /Second .* link/);
    assert(text.includes('Review: ' + ADMIN + '/'));
    assert.deepEqual((await f.rows()).map(row => row.notified), [1, 1]);
    f.logs.length = 0;
    await f.scheduled();
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(f.logs.filter(line => line.includes('send_email binding called')).length, 0);
  });
});
