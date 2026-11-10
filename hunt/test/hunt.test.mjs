// Runs the bundled hunt Worker in workerd (via Miniflare) against a local D1 database with made-up puzzle data:
// these tests know nothing of the real answers, which exist only in the private solution book.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Log, LogLevel, Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { applyMigrations } from '../scripts/migrate.mjs';
import { dmarcPassed, rangerReply, shouldAnswer } from '../src/mail.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://g3rry.com';
const KEY = 'test-hunt-key-0123456789abcdef0123456789abcdef';
const mac = text => createHmac('sha256', KEY).update(text).digest('hex');
const answers = { 'four-tries': mac('four-tries:TESTWORDA'), 'dig': mac('dig:QUARTZ') };
const nudges = { [mac('dig:QUARTZITE')]: 'Shorter.' };
const finaleNumber = '5551234';           // 1-800-JJJ-1234
const trail = [['one', 301], ['two', 302], ['three', 307], ['four', 308]];
const board = { banner: ['/\\'], lines: ['Welcome.'] };
const hints = { 'four-tries': ['First.', 'Second.', 'Third.'] };
const notes = { 'four-tries': 'A note from history.' };
const solvedAll = { 'four-tries': 'testworda', dig: 'quartz' };

let mf, db;
const randomIp = () => '10.' + [0, 0, 0].map(() => Math.floor(Math.random() * 250)).join('.');
const get = (pathname, ip = randomIp()) => mf.dispatchFetch(SITE + pathname, { headers: { 'CF-Connecting-IP': ip }, redirect: 'manual' });
const post = (pathname, body, { ip = randomIp(), origin = SITE } = {}) => mf.dispatchFetch(SITE + pathname, {
  method: 'POST', body: JSON.stringify(body),
  headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip, 'Sec-Fetch-Site': 'same-origin', ...(origin ? { Origin: origin } : {}) }
});
const dial = (number, solved, options) => post('/api/hunt/dial', { number, ...(solved ? { solved } : {}) }, options).then(response => response.json());

before(async () => {
  mf = new Miniflare(convertV4MiniflareOptions({
    log: new (class extends Log { log() {} })(LogLevel.NONE),
    modules: true, compatibilityDate: '2026-10-15', cache: false, stripCfConnectingIp: false,
    routes: ['g3rry.com/api/hunt*', 'g3rry.com/api/counter*'],
    scriptPath: path.join(root, 'build/index.js'),
    d1Databases: { DB: 'hunt' },
    ratelimits: {
      CHECK_LIMIT: { namespace_id: '1', simple: { limit: 20, period: 60 } },
      DIAL_LIMIT: { namespace_id: '2', simple: { limit: 10, period: 60 } },
      COUNTER_LIMIT: { namespace_id: '3', simple: { limit: 30, period: 60 } }
    },
    bindings: {
      SITE_ORIGIN: SITE, RANGER_ADDRESS: 'ranger@g3rry.com', HUNT_KEY: KEY, IP_PEPPER: 'test-pepper-0123456789abcdef0123456789abcdef',
      TEST_ANSWERS: JSON.stringify(answers), TEST_NUDGES: JSON.stringify(nudges), TEST_FINALES: JSON.stringify([mac('finale:' + finaleNumber)]),
      TEST_WRONG_DAILY: '12'
    }
  }));
  db = await mf.getD1Database('DB');
  await applyMigrations(db);
  for (const [key, value] of Object.entries({ trail, bbs: board, ranger: { subject: 'Re', text: 'Plain.', html: '<p>Rich.</p>' }, hints, notes })) {
    await db.prepare('INSERT INTO content (key, value) VALUES (?, ?)').bind(key, JSON.stringify(value)).run();
  }
});
after(() => mf.dispose());

test('a right answer is accepted however it is typed, with its field note', async () => {
  for (const answer of ['testworda', ' T-E-S-T-W-O-R-D-A ', 'Testworda!']) {
    const response = await post('/api/hunt/check', { id: 'four-tries', answer });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { correct: true, note: 'A note from history.' });
  }
  assert.deepEqual(await (await post('/api/hunt/check', { id: 'dig', answer: 'quartz' })).json(), { correct: true }, 'no note, no field');
});

test('a wrong answer is refused, with a nudge where one is written', async () => {
  assert.deepEqual(await (await post('/api/hunt/check', { id: 'four-tries', answer: 'pebble' })).json(), { correct: false });
  assert.deepEqual(await (await post('/api/hunt/check', { id: 'dig', answer: 'quartzite' })).json(), { correct: false, nudge: 'Shorter.' });
  assert.deepEqual(await (await post('/api/hunt/check', { id: 'dig', answer: 'testworda' })).json(), { correct: false });
});

test('checks refuse unknown puzzles, empty answers, extra fields and other origins', async () => {
  assert.equal((await post('/api/hunt/check', { id: 'nope', answer: 'x' })).status, 400);
  assert.equal((await post('/api/hunt/check', { id: 'dig', answer: '***' })).status, 400);
  assert.equal((await post('/api/hunt/check', { id: 'dig', answer: 'x', more: 1 })).status, 400);
  assert.equal((await post('/api/hunt/check', { id: 'dig', answer: 'x' }, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await post('/api/hunt/check', { id: 'dig', answer: 'x' }, { origin: null })).status, 403);
  assert.equal((await get('/api/hunt/check')).status, 405);
});

test('guessing is limited per address, per minute and per stratum per day', async () => {
  const ip = randomIp();
  const statuses = [];
  for (let i = 0; i < 22; i++) statuses.push((await post('/api/hunt/check', { id: i % 2 ? 'dig' : 'four-tries', answer: 'guess' + i }, { ip })).status);
  assert.equal(statuses.filter(status => status === 200).length, 20);
  assert.equal(statuses.at(-1), 429);

  const patient = randomIp();
  const results = [];
  for (let i = 0; i < 13; i++) results.push(await post('/api/hunt/check', { id: 'dig', answer: 'word' + i }, { ip: patient }));
  assert.deepEqual(results.slice(0, 12).map(response => response.status), Array(12).fill(200));
  assert.equal(results[12].status, 429);
  assert.deepEqual(await results[12].json(), { error: 'enough_for_today' });
  assert.equal((await post('/api/hunt/check', { id: 'four-tries', answer: 'other' }, { ip: patient })).status, 200, 'other strata stay open');
});

test('the ranger gives hints one tier at a time', async () => {
  assert.deepEqual(await (await get('/api/hunt/hint?id=four-tries&tier=2')).json(), { id: 'four-tries', tier: 2, tiers: 3, text: 'Second.' });
  assert.equal((await get('/api/hunt/hint?id=four-tries&tier=4')).status, 400);
  assert.equal((await get('/api/hunt/hint?id=four-tries&tier=x')).status, 400);
  assert.equal((await get('/api/hunt/hint?id=dig&tier=1')).status, 404);
});

test('the trail turns with its own status at every step and ends at the hub', async () => {
  let pathname = '/api/hunt/trail/one';
  const seen = [];
  for (let i = 0; i < trail.length; i++) {
    const response = await get(pathname);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    seen.push(response.status);
    pathname = new URL(response.headers.get('Location')).pathname + new URL(response.headers.get('Location')).hash;
  }
  assert.deepEqual(seen, trail.map(([, status]) => status));
  assert.equal(pathname, '/strata/#long-way-round');
  assert.equal((await get('/api/hunt/trail/five')).status, 404);
  assert.equal((await get('/api/hunt/trail/ONE')).status, 404);
});

test('the carbon copy is the same two-part letter the ranger mails', async () => {
  const response = await get('/api/hunt/ranger.eml');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Content-Type'), /^text\/plain/);
  const raw = await response.text();
  assert.match(raw, /multipart\/alternative/);
  assert.ok(raw.includes('Plain.') && raw.includes('<p>Rich.</p>'));
});

test('the mountain answers however the number is written; other numbers fail the same way each time', async () => {
  for (const number of ['1-800-' + finaleNumber, finaleNumber, '1 800 JJJ 1234', '1-800-555-12349']) {
    assert.equal((await dial(number)).connected, true, number);
  }
  const first = await dial('555 0000');
  const again = await dial('5550000');
  assert.equal(first.connected, false);
  assert.ok(['busy', 'no-carrier', 'not-in-service', 'no-answer'].includes(first.outcome));
  assert.deepEqual(first, again);
  assert.equal((await dial('555123')).connected, false, 'six digits are not enough');
  assert.equal((await post('/api/hunt/dial', { number: '12' })).status, 400);
});

test('the board checks the route before it hands out a flag', async () => {
  const stranger = await dial(finaleNumber);
  assert.equal(stranger.connected, true);
  assert.deepEqual(stranger.board, board);
  assert.deepEqual(stranger.route, [{ id: 'four-tries', ok: false }, { id: 'dig', ok: false }]);
  assert.equal(stranger.needed, 1);
  assert.equal(stranger.token, undefined, 'no route, no flag');

  const forged = await dial(finaleNumber, { 'four-tries': 'nonsense', dig: 'quartz', extra: 'x' });
  assert.deepEqual(forged.route, [{ id: 'four-tries', ok: false }, { id: 'dig', ok: true }]);
  assert.match(forged.token, /^\d{13}\.[0-9a-f]{24}\.1\.[0-9a-f]{64}$/);

  const climber = await dial(finaleNumber, solvedAll);
  assert.match(climber.token, /^\d{13}\.[0-9a-f]{24}\.2\.[0-9a-f]{64}$/);
  assert.equal((await post('/api/hunt/dial', { number: finaleNumber, solved: ['quartz'] })).status, 200, 'a malformed route counts as none');
});

test('a board token plants one numbered flag, a few a day per address', async () => {
  const { token } = await dial(finaleNumber, solvedAll);
  const ip = randomIp();
  assert.equal((await post('/api/hunt/flag', { token, colour: 'purple' }, { ip })).status, 400);
  const planted = await post('/api/hunt/flag', { token, colour: 'red' }, { ip });
  assert.equal(planted.status, 201);
  const flag = await planted.json();
  assert.equal(flag.colour, 'red');
  assert.equal(flag.strata, 2);
  assert.equal(typeof flag.number, 'number');
  assert.equal((await post('/api/hunt/flag', { token, colour: 'blue' }, { ip: randomIp() })).status, 409, 'a token plants once');
  const next = await post('/api/hunt/flag', { token: (await dial(finaleNumber, solvedAll)).token, colour: 'blue' }, { ip });
  assert.equal(next.status, 201);
  assert.equal((await next.json()).number, flag.number + 1, 'a refused token uses up no number');
  assert.equal((await post('/api/hunt/flag', { token: (await dial(finaleNumber, solvedAll)).token, colour: 'blue' }, { ip })).status, 201);
  const fourth = await post('/api/hunt/flag', { token: (await dial(finaleNumber, solvedAll)).token, colour: 'blue' }, { ip });
  assert.equal(fourth.status, 429, 'three flags a day per address');
  const listed = await get('/api/hunt/flags');
  assert.equal(listed.headers.get('Cache-Control'), 'no-store');
  const list = await listed.json();
  assert.ok(list.flags.some(item => item.number === flag.number && item.colour === 'red' && item.strata === 2));
  assert.deepEqual(list.flags.map(item => item.number), [...list.flags.map(item => item.number)].sort((a, b) => a - b), 'oldest first');
  assert.ok(!JSON.stringify(list).includes('ip'), 'flags carry no address');
});

test('forged, altered and stale tokens plant nothing', async () => {
  const forged = Date.now() + '.' + 'a'.repeat(24) + '.2.' + 'b'.repeat(64);
  assert.equal((await post('/api/hunt/flag', { token: forged, colour: 'red' })).status, 403);
  const { token } = await dial(finaleNumber, { dig: 'quartz' });
  const promoted = token.replace(/\.1\./, '.2.');
  assert.equal((await post('/api/hunt/flag', { token: promoted, colour: 'red' })).status, 403, 'the count is signed');
  const old = (Date.now() - 3 * 60 * 60 * 1000) + '.' + 'c'.repeat(24) + '.2';
  assert.equal((await post('/api/hunt/flag', { token: old + '.' + mac('flag:' + old), colour: 'red' })).status, 403);
  assert.equal((await post('/api/hunt/flag', { token: 'nonsense', colour: 'red' })).status, 403);
});

test('the counters count, but not a visitor reloading in a hurry', async () => {
  const before = (await (await get('/api/counter?year=1996')).json()).count;
  assert.equal((await (await get('/api/counter?year=1996')).json()).count, before + 1);
  const ip = randomIp();
  let last;
  for (let i = 0; i < 32; i++) last = (await (await get('/api/counter?year=1999', ip)).json()).count;
  assert.equal(last, 30);
  assert.equal((await get('/api/counter?year=2003')).status, 400);
  assert.equal((await get('/api/counter')).status, 400);
});

test('requests for other paths, methods or hosts are not answered', async () => {
  assert.equal((await get('/api/hunt')).status, 404);
  assert.equal((await post('/api/hunt/flags', {})).status, 405);
  assert.equal((await mf.dispatchFetch('https://www.g3rry.com/api/hunt/flags')).status, 404);
});

test('the ranger writes one letter twice, threaded, as an automatic reply', () => {
  const raw = rangerReply({ from: 'ranger@g3rry.com', to: 'climber@example.com', subject: 'Re: hello', text: 'Plain words.\nSecond line.', html: '<p>Rich words.</p>',
    inReplyTo: '<abc@example.com>', references: '<root@example.com>', id: 'f00d', date: new Date(Date.UTC(2026, 10, 8)) });
  const [head, body] = raw.split('\r\n\r\n');
  assert.match(head, /^From: The ranger <ranger@g3rry\.com>\r\n/);
  assert.match(head, /\r\nIn-Reply-To: <abc@example\.com>\r\n/);
  assert.match(head, /\r\nReferences: <root@example\.com> <abc@example\.com>\r\n/);
  assert.match(head, /\r\nAuto-Submitted: auto-replied\r\n/);
  assert.match(head, /multipart\/alternative; boundary="ranger-f00d"/);
  assert.ok(body.startsWith('This is a message in two parts.'));
  assert.ok(raw.includes('Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: 7bit\r\n\r\nPlain words.\r\nSecond line.'));
  assert.ok(raw.includes('Content-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: 7bit\r\n\r\n<p>Rich words.</p>'));
  assert.ok(raw.endsWith('--ranger-f00d--\r\n'));
  assert.ok(!/\r\n(?!\r\n)[^\r]*\n/.test(raw.replace(/\r\n/g, '')), 'no bare line feeds');
  const injected = rangerReply({ from: 'ranger@g3rry.com', to: 'a@example.com\r\nBcc: victim@example.com', subject: 's', text: 't', html: 'h', id: '1' });
  assert.ok(!/\r\nBcc:/.test(injected), 'header values cannot add headers');
  const unicode = rangerReply({ from: 'ranger@g3rry.com', to: 'a@example.com', subject: 's', text: 'Névé', html: 'h', id: '2' });
  assert.ok(unicode.includes('Content-Transfer-Encoding: base64\r\n\r\nTsOpdsOp'));
  const long = rangerReply({ from: 'ranger@g3rry.com', to: 'a@example.com', subject: 's', text: 't', html: 'h', id: '3', inReplyTo: '<' + 'x'.repeat(5000) + '@example.com>' });
  assert.ok(long.split('\r\n').every(line => line.length <= 998), 'no header line past 998 characters');
  assert.ok(!/In-Reply-To/.test(long), 'an absurd Message-ID is dropped');
});

test('only the first Authentication-Results, written by Email Routing, counts, and only its own dmarc result', () => {
  assert.equal(dmarcPassed('mx.cloudflare.net; dkim=pass header.d=example.com; spf=pass; dmarc=pass header.from=example.com'), true);
  assert.equal(dmarcPassed('mx.cloudflare.net; dkim=fail; spf=fail; dmarc=fail header.from=example.com, evil.example; dmarc=pass'), false);
  assert.equal(dmarcPassed('evil.example; dmarc=pass, mx.cloudflare.net; dmarc=fail'), false);
  assert.equal(dmarcPassed('mx.cloudflare.net; spf=fail smtp.mailfrom="dmarc=pass"@evil.example; dmarc=fail header.from=evil.example'), false, 'quoted text');
  assert.equal(dmarcPassed('mx.cloudflare.net; spf=fail smtp.mailfrom="x;dmarc=pass"@evil.example; dmarc=fail'), false, 'a quoted semicolon');
  assert.equal(dmarcPassed('mx.cloudflare.net; dmarc=fail (not dmarc=pass) header.from=evil.example'), false, 'a comment');
  assert.equal(dmarcPassed('mx.cloudflare.net; spf=fail smtp.mailfrom=dmarc=pass@evil.example; dmarc=none'), false, 'an unquoted local part');
  assert.equal(dmarcPassed(null), false);
});

test('the ranger answers people, not robots, lists, bounces or strangers to their own domain', () => {
  const pass = 'mx.cloudflare.net; dkim=pass header.d=example.com; spf=pass smtp.mailfrom=climber@example.com; dmarc=pass header.from=example.com';
  const headers = extra => new Headers({ 'Authentication-Results': pass, From: 'A Climber <climber@example.com>', ...extra });
  assert.deepEqual(shouldAnswer('climber@example.com', headers()), { ok: true });
  assert.equal(shouldAnswer('climber@mail.example.com', headers()).ok, true, 'a subdomain aligns');
  assert.equal(shouldAnswer('victim@other.example', headers()).reason, 'misaligned');
  assert.equal(shouldAnswer('climber@example.com', headers({ From: 'climber@other.example' })).reason, 'misaligned');
  assert.equal(shouldAnswer('climber@example.com', headers({ 'Auto-Submitted': 'auto-replied' })).reason, 'automatic');
  assert.equal(shouldAnswer('climber@example.com', headers({ 'Auto-Submitted': 'no' })).ok, true);
  assert.equal(shouldAnswer('climber@example.com', headers({ Precedence: 'bulk' })).reason, 'list');
  assert.equal(shouldAnswer('climber@example.com', headers({ 'List-Id': '<list.example.com>' })).reason, 'list');
  assert.equal(shouldAnswer('MAILER-DAEMON@example.com', headers()).reason, 'bounce');
  assert.equal(shouldAnswer('', headers()).reason, 'bounce');
  const failed = shouldAnswer('climber@example.com', headers({ 'Authentication-Results': 'mx.cloudflare.net; dmarc=fail header.from=example.com' }));
  assert.deepEqual(failed, { ok: false, reason: 'unverified', detail: { authserv: 'mx.cloudflare.net', dmarc: 'fail' } });
});
