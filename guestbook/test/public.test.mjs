import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { SITE, day, note, startFixture } from './fixture.mjs';

let f;
before(async () => { f = await startFixture(); });
after(async () => { await f.mf.dispose(); });
beforeEach(async () => { await f.reset(); });

describe('reading notes', () => {
  test('returns only approved notes and only public fields', async () => {
    await f.insert({ name: 'Approved', status: 'approved', ip_hash: 'a'.repeat(32), country: 'US', flags: 'link', reply: 'Thanks!', reply_at: 5 });
    await f.insert({ name: 'Waiting', status: 'pending' });
    await f.insert({ name: 'Rejected', status: 'rejected' });
    await f.insert({ name: 'Spam', status: 'spam' });
    const response = await f.list();
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.deepEqual(data.entries.map(entry => entry.name), ['Approved']);
    assert.deepEqual(Object.keys(data.entries[0]).sort(), ['date', 'id', 'message', 'name', 'reply']);
    assert.deepEqual(data.entries[0].reply, { message: 'Thanks!', date: 5 });
    assert.equal(data.open, true);
    assert.equal(data.next, null);
  });

  test('API responses cannot be rendered, framed or read cross-origin', async () => {
    const response = await f.list();
    assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('content-security-policy'), "default-src 'none'; frame-ancestors 'none'");
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  });

  test('pages through notes newest first with a validated cursor', async () => {
    const base = Date.now() - 1000;
    for (let index = 0; index < 25; index++) await f.insert({ name: 'N' + index, status: 'approved', created_at: base + index });
    const first = await (await f.list()).json();
    assert.equal(first.entries.length, 20);
    assert.equal(first.entries[0].name, 'N24');
    assert.match(first.next, /^\d+_[0-9a-f]{32}$/);
    const second = await (await f.list('?cursor=' + first.next)).json();
    assert.deepEqual(second.entries.map(entry => entry.name), ['N4', 'N3', 'N2', 'N1', 'N0']);
    assert.equal(second.next, null);
    assert.equal(second.open, undefined);
    for (const bad of ['1', 'abc_def', "1_' OR 1=1 --", '1_' + 'g'.repeat(32)]) {
      assert.equal((await f.list('?cursor=' + encodeURIComponent(bad))).status, 400, bad);
    }
  });

  test('answers only on its own origin, path and methods', async () => {
    assert.equal((await f.publicFetch('https://169373219.workers.dev/api/guestbook')).status, 404);
    assert.equal((await f.publicFetch(SITE + '/api/guestbook/x')).status, 404);
    assert.equal((await f.publicFetch(SITE + '/api/guestbooks')).status, 404);
    const put = await f.publicFetch(SITE + '/api/guestbook', { method: 'PUT', body: '{}', headers: { Origin: SITE } });
    assert.equal(put.status, 405);
  });
});

describe('submitting a note', () => {
  test('stores a valid note as pending, never public, with a hashed address', async () => {
    const response = await f.submit(note(), { ip: '203.0.113.10', cf: { country: 'NZ' } });
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { status: 'pending' });
    const [row] = await f.rows();
    assert.equal(row.status, 'pending');
    assert.equal(row.name, 'Ada');
    assert.equal(row.ip_hash, await f.hash('203.0.113.10'));
    assert.match(row.ip_hash, /^[0-9a-f]{32}$/);
    assert.equal(row.country, 'NZ');
    assert.match(row.id, /^[0-9a-f]{32}$/);
    assert.deepEqual(f.siteverify[0], { secret: 'test-secret', response: 'good', remoteip: '203.0.113.10', idempotency_key: f.siteverify[0].idempotency_key });
    assert.equal((await (await f.list()).json()).entries.length, 0);
  });

  test('refuses posts from other origins before doing any work', async () => {
    for (const [origin, headers] of [[null, {}], ['https://evil.example', {}], ['https://admin.g3rry.com', {}], ['http://g3rry.com', {}], [SITE, { 'Sec-Fetch-Site': 'cross-site' }], [SITE, { 'Sec-Fetch-Site': 'same-site' }]]) {
      const response = await f.submit(note(), { origin, headers });
      assert.equal(response.status, 403, String(origin) + JSON.stringify(headers));
    }
    assert.equal(f.siteverify.length, 0);
    assert.equal((await f.rows()).length, 0);
  });

  test('accepts only small JSON objects with known fields', async () => {
    assert.equal((await f.submit(null, { raw: 'name=a', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })).status, 415);
    assert.equal((await f.submit(null, { raw: JSON.stringify(note()), headers: { 'Content-Type': 'text/plain' } })).status, 415);
    assert.equal((await f.submit(null, { raw: '{"name":' })).status, 400);
    assert.equal((await f.submit(null, { raw: '[1,2]' })).status, 400);
    assert.equal((await f.submit(null, { raw: '"text"' })).status, 400);
    assert.equal((await f.submit({ ...note(), status: 'approved' })).status, 400);
    assert.equal((await f.submit(null, { raw: JSON.stringify(note({ message: 'x'.repeat(20000) })) })).status, 413);
    assert.equal(f.siteverify.length, 0);
    assert.equal((await f.rows()).length, 0);
  });

  test('a filled honeypot looks accepted but stores nothing', async () => {
    const response = await f.submit(note({ website: 'https://spam.example' }));
    assert.equal(response.status, 202);
    assert.equal(f.siteverify.length, 0);
    assert.equal((await f.rows()).length, 0);
  });

  test('validates fields before spending the Turnstile token', async () => {
    const cases = [
      [{ name: '' }, { name: 'required' }],
      [{ name: '   ' }, { name: 'required' }],
      [{ name: 123 }, { name: 'required' }],
      [{ name: 'x'.repeat(41) }, { name: 'too_long' }],
      [{ name: '...' }, { name: 'invalid' }],
      [{ name: 'Gerry' }, { name: 'reserved' }],
      [{ name: 'G3RRY Zhao' }, { name: 'reserved' }],
      [{ name: 'G\u0435rry' }, { name: 'reserved' }],
      [{ name: 'Admin' }, { name: 'reserved' }],
      [{ message: '' }, { message: 'required' }],
      [{ message: '!!! ???' }, { message: 'invalid' }],
      [{ message: 'y'.repeat(1001) }, { message: 'too_long' }]
    ];
    for (const [fields, errors] of cases) {
      const response = await f.submit(note(fields));
      assert.equal(response.status, 422, JSON.stringify(fields));
      assert.deepEqual((await response.json()).fields, errors, JSON.stringify(fields));
    }
    assert.equal(f.siteverify.length, 0);
  });

  test('requires a Turnstile token solved on this site for this form', async () => {
    for (const token of [undefined, '', 'bad', 'other-host', 'other-action', 'x'.repeat(2049)]) {
      const response = await f.submit(note({ token }), { ip: '203.0.113.' + Math.floor(Math.random() * 200) });
      assert.equal(response.status, 403, String(token).slice(0, 20));
    }
    assert.equal(f.siteverify.length, 3, 'missing and oversized tokens are rejected without calling Siteverify');
    assert.equal((await f.rows()).length, 0);
  });

  test('fails closed when Turnstile is unreachable', async () => {
    const response = await f.submit(note({ token: 'down' }));
    assert.equal(response.status, 503);
    assert.equal((await f.rows()).length, 0);
  });

  test('stores text exactly as text, so markup and SQL are inert', async () => {
    const message = '<script>alert(1)</script> <img src=x onerror=alert(2)> \'); DROP TABLE entries; --';
    assert.equal((await f.submit(note({ name: "Bobby'); --", message }))).status, 202);
    const [row] = await f.rows();
    assert.equal(row.name, "Bobby'); --");
    assert.equal(row.body, message);
    await f.db.prepare("UPDATE entries SET status = 'approved'").run();
    const data = await (await f.list()).json();
    assert.equal(data.entries[0].message, message);
  });

  test('strips characters that hide or reorder text', async () => {
    const response = await f.submit(note({
      name: '\u202EAda\u200B\u2066 Lovelace\u0000',
      message: 'Line one\r\nLine two\u0007\n\n\n\nZa\u0301\u0302\u0303\u0304\u0305\u0306\u0307lgo\u{E0041}\u{E0042}'
    }));
    assert.equal(response.status, 202);
    const [row] = await f.rows();
    assert.equal(row.name, 'Ada Lovelace');
    assert.equal(row.body, 'Line one\nLine two\n\nZ\u00E1\u0302\u0303\u0304\u0305lgo');
  });

  test('flags links and copies; refuses the same text twice from one sender', async () => {
    assert.equal((await f.submit(note({ message: 'Visit https://a.example and www.b.example and c.xyz now' }), { ip: '203.0.113.20' })).status, 202);
    assert.equal((await f.submit(note({ message: 'Same words here' }), { ip: '203.0.113.21' })).status, 202);
    assert.equal((await f.submit(note({ message: 'same   WORDS, here!' }), { ip: '203.0.113.21' })).status, 409);
    assert.equal((await f.submit(note({ message: 'Same words here' }), { ip: '203.0.113.22' })).status, 202);
    const rows = await f.rows();
    assert.deepEqual(rows.map(row => row.flags), ['many-links', '', 'duplicate']);
  });

  test('limits bursts per address', async () => {
    const statuses = [];
    for (let index = 0; index < 4; index++) statuses.push((await f.submit(note({ message: 'Burst number ' + index }), { ip: '203.0.113.30' })).status);
    assert.deepEqual(statuses, [202, 202, 202, 429]);
  });

  test('caps notes per address per day, counting an IPv6 /64 as one address', async () => {
    const hash = await f.hash('2001:db8:1:2::1');
    assert.equal(hash, await f.hash('2001:0db8:0001:0002:ffff:eeee:dddd:cccc'));
    assert.notEqual(hash, await f.hash('2001:db8:1:3::1'));
    for (let index = 0; index < 10; index++) await f.insert({ ip_hash: hash, created_at: Date.now() - index * 1000 });
    assert.equal((await f.submit(note(), { ip: '2001:db8:1:2:aaaa::9' })).status, 429);
    await f.db.prepare('UPDATE entries SET created_at = ?').bind(Date.now() - day - 1000).run();
    assert.equal((await f.submit(note(), { ip: '2001:db8:1:2:aaaa::9' })).status, 202);
  });

  test('banned senders are told nothing and nothing is stored', async () => {
    await f.db.prepare('INSERT INTO bans (ip_hash, until, created_at) VALUES (?, ?, ?)').bind(await f.hash('203.0.113.40'), Date.now() + day, Date.now()).run();
    assert.equal((await f.submit(note(), { ip: '203.0.113.40' })).status, 202);
    assert.equal((await f.rows()).length, 0);
  });

  test('refuses new notes once the review queue is full', async () => {
    for (let index = 0; index < 200; index++) await f.insert({ status: 'pending' });
    assert.equal((await f.submit(note())).status, 503);
    assert.equal((await f.rows("SELECT * FROM entries")).length, 200);
  });

  test('closing submissions blocks posting and is reported to the page', async () => {
    await f.db.prepare("UPDATE settings SET value = '0' WHERE key = 'submissions_open'").run();
    const response = await f.submit(note());
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, 'closed');
    assert.equal((await (await f.list()).json()).open, false);
  });
});
