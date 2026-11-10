// Strata, the hunt under g3rry.com, and the hit counters of the early years.
//   POST /api/hunt/check     { id, answer }       is this the answer to that stratum? (a field note comes with a yes)
//   GET  /api/hunt/hint?id=&tier=                 the ranger's notes for a stuck climber, one tier at a time
//   GET  /api/hunt/trail/:w                       one turn of the long way round (a redirect with a numbered status)
//   GET  /api/hunt/ranger.eml                     the station's carbon copy of the ranger's letter
//   POST /api/hunt/dial      { number, solved }   what answers when the modem dials this number
//   POST /api/hunt/flag      { token, colour }    plant a flag on the summit (the token comes from the board)
//   GET  /api/hunt/flags                          every flag planted so far
//   GET  /api/counter?year=1996                   count one visit to that year
// Mail to the ranger is answered by the email handler below.
import { EmailMessage } from 'cloudflare:email';
import { HttpError, failure, hex, json, log, onlyKeys, readJson, sameOrigin, sha256 } from '../../guestbook/src/lib/http.js';
import { ipHash } from '../../guestbook/src/lib/ip.js';
import { ANSWERS, FINALES, NUDGES } from './answers.js';
import { rangerReply, shouldAnswer } from './mail.js';

const encoder = new TextEncoder();
const COLOURS = ['red', 'orange', 'yellow', 'green', 'blue', 'white'];
const COUNTED_YEARS = [1996, 1999];
const TOKEN_AGE = 2 * 60 * 60 * 1000;
const day = 24 * 60 * 60 * 1000;
const RANGER_DAILY = 3;          // replies per sender per day
const RANGER_DAILY_TOTAL = 200;  // replies per day in all
const FLAGS_DAILY = 3;           // flags per address per day (a dorm or a campus shares one address)
const SPARE = 3;                 // strata a climber may leave unsolved and still plant a flag
const WRONG_DAILY = 60;          // wrong answers per address, stratum and day
const security = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cross-Origin-Resource-Policy': 'same-origin' };

export const normalise = value => String(value ?? '').normalize('NFKD').toUpperCase().replace(/[^A-Z0-9]/g, '');
// Letters on a telephone keypad: 1-800-FLOWERS dials 1-800-356-9377.
export const keypad = value => String(value ?? '').toUpperCase().replace(/[A-Z]/g, letter => '22233344455566677778889999'[letter.charCodeAt(0) - 65]);

const keys = new Map();
async function hmac(secret, text) {
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('HUNT_KEY is missing or too short.');
  if (!keys.has(secret)) keys.set(secret, await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']));
  return hex(await crypto.subtle.sign('HMAC', keys.get(secret), encoder.encode(text)));
}
// Constant-time comparison of two hex digests.
function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Tests substitute their own tables; production never sets these variables.
const answers = env => (env.TEST_ANSWERS ? JSON.parse(env.TEST_ANSWERS) : ANSWERS);
const nudges = env => (env.TEST_NUDGES ? JSON.parse(env.TEST_NUDGES) : NUDGES);
const finales = env => (env.TEST_FINALES ? JSON.parse(env.TEST_FINALES) : FINALES);
const wrongDaily = env => Number(env.TEST_WRONG_DAILY) || WRONG_DAILY;

const cache = new Map();
async function content(env, key, { optional = false } = {}) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.value;
  const row = await env.DB.prepare('SELECT value FROM content WHERE key = ?').bind(key).first();
  if (!row) {
    if (optional) return null;
    throw new HttpError(503, 'not_ready');
  }
  const value = JSON.parse(row.value);
  cache.set(key, { at: Date.now(), value });
  return value;
}

// A missing binding is a deployment mistake, not a reason to stop limiting: refuse instead.
async function allowed(limit, key) {
  if (!limit) throw new HttpError(503, 'not_ready');
  const { success } = await limit.limit({ key });
  return success;
}

const routes = {
  GET: {
    '/api/counter': (url, env, ip) => counter(url, env, ip),
    '/api/hunt/flags': (url, env) => flags(env),
    '/api/hunt/hint': (url, env, ip) => hint(url, env, ip),
    '/api/hunt/ranger.eml': (url, env, ip) => carbonCopy(env, ip)
  },
  POST: { '/api/hunt/check': check, '/api/hunt/dial': dial, '/api/hunt/flag': plant }
};
const BODY_LIMIT = { '/api/hunt/dial': 4096 };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.origin !== env.SITE_ORIGIN) return failure(404, 'not_found');
    try {
      const ip = await ipHash(request.headers.get('CF-Connecting-IP') ?? '', env.IP_PEPPER);
      const route = url.pathname;
      const trailTurn = /^\/api\/hunt\/trail\/([a-z]{1,20})$/.exec(route);
      if (trailTurn) return request.method === 'GET' ? await trail(trailTurn[1], env) : failure(405, 'method_not_allowed', { Allow: 'GET' });
      const method = Object.keys(routes).find(name => routes[name][route]);
      if (!method) return failure(404, 'not_found');
      if (request.method !== method) return failure(405, 'method_not_allowed', { Allow: method });
      if (method === 'GET') return await routes.GET[route](url, env, ip);
      if (!sameOrigin(request, env.SITE_ORIGIN)) return failure(403, 'cross_origin');
      return await routes.POST[route](await readJson(request, BODY_LIMIT[route] ?? 2048), env, ip);
    } catch (error) {
      if (error instanceof HttpError) return failure(error.status, error.code);
      log('error', { message: String(error?.message ?? error).slice(0, 200) });
      return failure(500, 'server_error');
    }
  },

  async email(message, env) {
    try {
      if (message.to.toLowerCase() !== env.RANGER_ADDRESS) {
        message.setReject('No such address.');
        return;
      }
      // Only people get answers, never robots, lists or bounces; only senders whose domain vouches for them (DMARC),
      // so a forged sender cannot aim replies at someone else; a few replies a day per sender, and a few hundred in all.
      const verdict = shouldAnswer(message.from, message.headers);
      if (!verdict.ok) return log('ranger_skipped', { reason: verdict.reason, ...verdict.detail });
      const sender = await hmac(env.HUNT_KEY, 'mail:' + message.from.toLowerCase());
      const today = Math.floor(Date.now() / day);
      const total = await env.DB.prepare('SELECT COALESCE(SUM(replies), 0) AS replies FROM mail_log WHERE day = ?').bind(today).first();
      if (total.replies >= RANGER_DAILY_TOTAL) return log('ranger_limited', { scope: 'all' });
      const row = await env.DB.prepare('INSERT INTO mail_log (sender_hash, day, replies) VALUES (?, ?, 1) ON CONFLICT (sender_hash, day) DO UPDATE SET replies = replies + 1 RETURNING replies')
        .bind(sender, today).first();
      if (row.replies > RANGER_DAILY) return log('ranger_limited', { scope: 'sender' });
      const letter = await content(env, 'ranger');
      const raw = rangerReply({
        from: env.RANGER_ADDRESS, to: message.from, subject: letter.subject, text: letter.text, html: letter.html,
        inReplyTo: message.headers.get('Message-ID'), references: message.headers.get('References'),
        id: hex(crypto.getRandomValues(new Uint8Array(12)))
      });
      await message.reply(new EmailMessage(env.RANGER_ADDRESS, message.from, raw));
      log('ranger_replied');
      await env.DB.prepare('DELETE FROM mail_log WHERE day < ?').bind(today - 7).run();
    } catch (error) {
      log('ranger_error', { message: String(error?.message ?? error).slice(0, 200) });
    }
  }
};

async function check(data, env, ip) {
  onlyKeys(data, ['id', 'answer']);
  const id = String(data.id ?? '');
  const table = answers(env);
  if (!Object.hasOwn(table, id) && id !== 'meta') throw new HttpError(400, 'unknown_puzzle');
  const answer = normalise(data.answer);
  if (!answer || answer.length > 40) throw new HttpError(400, 'bad_answer');
  if (!(await allowed(env.CHECK_LIMIT, ip))) throw new HttpError(429, 'slow_down');
  const today = Math.floor(Date.now() / day);
  const tally = await env.DB.prepare('SELECT wrong FROM guesses WHERE ip_hash = ? AND puzzle = ? AND day = ?').bind(ip, id, today).first();
  if (tally && tally.wrong >= wrongDaily(env)) throw new HttpError(429, 'enough_for_today');
  const digest = await hmac(env.HUNT_KEY, id + ':' + answer);
  if (Object.hasOwn(table, id) && same(digest, table[id])) {
    const notes = await content(env, 'notes', { optional: true });
    return json({ correct: true, ...(notes?.[id] ? { note: notes[id] } : {}) });
  }
  const nudge = nudges(env)[digest];
  if (!nudge) {
    await env.DB.prepare('INSERT INTO guesses (ip_hash, puzzle, day, wrong) VALUES (?, ?, ?, 1) ON CONFLICT (ip_hash, puzzle, day) DO UPDATE SET wrong = wrong + 1')
      .bind(ip, id, today).run();
    if (Math.random() < 0.02) await env.DB.prepare('DELETE FROM guesses WHERE day < ?').bind(today - 2).run();
  }
  return json({ correct: false, ...(nudge ? { nudge } : {}) });
}

// The ranger's notes for one stratum, one tier at a time. The page decides when to offer the next tier.
async function hint(url, env, ip) {
  const id = url.searchParams.get('id') ?? '';
  const tier = Number(url.searchParams.get('tier'));
  const hints = await content(env, 'hints');
  if (!Object.hasOwn(hints, id)) return failure(404, 'not_found');
  if (!Number.isInteger(tier) || tier < 1 || tier > hints[id].length) return failure(400, 'bad_tier');
  if (!(await allowed(env.CHECK_LIMIT, 'hint:' + ip))) throw new HttpError(429, 'slow_down');
  return json({ id, tier, tiers: hints[id].length, text: hints[id][tier - 1] }, 200, { 'Cache-Control': 'public, max-age=300' });
}

// Each turn answers with its own redirect status; the last one leads back to the hub.
async function trail(word, env) {
  const turns = await content(env, 'trail');
  const index = turns.findIndex(([name]) => name === word);
  if (index < 0) return failure(404, 'not_found');
  const next = index + 1 < turns.length ? '/api/hunt/trail/' + turns[index + 1][0] : '/strata/#long-way-round';
  return new Response('Turn ' + (index + 1) + '.\n', {
    status: turns[index][1],
    headers: { ...security, Location: env.SITE_ORIGIN + next, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

// The same letter the ranger mails, as raw source, for climbers whose mail never arrives.
async function carbonCopy(env, ip) {
  if (!(await allowed(env.CHECK_LIMIT, 'eml:' + ip))) throw new HttpError(429, 'slow_down');
  const letter = await content(env, 'ranger');
  const raw = rangerReply({ from: env.RANGER_ADDRESS, to: 'climber@example.invalid', subject: letter.subject, text: letter.text, html: letter.html, id: 'carbon-copy' });
  return new Response(raw, {
    headers: { ...security, 'Content-Type': 'text/plain; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'", 'Cache-Control': 'public, max-age=300' }
  });
}

// Which strata this climber has solved, checked again here from the answers their browser kept.
async function verify(solved, env) {
  const table = answers(env);
  const given = solved && typeof solved === 'object' && !Array.isArray(solved) ? solved : {};
  if (Object.keys(given).length > 40) throw new HttpError(400, 'bad_route');
  return Promise.all(Object.keys(table).map(async id => {
    const answer = typeof given[id] === 'string' ? normalise(given[id]) : '';
    return { id, ok: Boolean(answer) && answer.length <= 40 && same(await hmac(env.HUNT_KEY, id + ':' + answer), table[id]) };
  }));
}

const OUTCOMES = ['busy', 'no-carrier', 'not-in-service', 'no-answer'];
async function dial(data, env, ip) {
  onlyKeys(data, ['number', 'solved']);
  const digits = keypad(data.number).replace(/\D/g, '');
  if (digits.length < 3 || digits.length > 24) throw new HttpError(400, 'bad_number');
  if (!(await allowed(env.DIAL_LIMIT, ip))) throw new HttpError(429, 'slow_down');
  // After 1-800 the exchange listens for seven digits and ignores the rest, so 1-800-MOUNTAIN still connects.
  const local = digits.replace(/^1?800/, '');
  const exchange = local.slice(0, 7);
  const digest = local.length >= 7 ? await hmac(env.HUNT_KEY, 'finale:' + exchange) : '';
  if (finales(env).some(finale => same(digest, finale))) {
    const board = await content(env, 'bbs');
    const route = await verify(data.solved, env);
    const solved = route.filter(stratum => stratum.ok).length;
    const needed = Math.max(1, route.length - SPARE);
    log('board_connected', { solved });
    const reply = { connected: true, board, route, needed };
    if (solved < needed) return json(reply);
    const issued = Date.now() + '.' + hex(crypto.getRandomValues(new Uint8Array(12))) + '.' + solved;
    return json({ ...reply, token: issued + '.' + (await hmac(env.HUNT_KEY, 'flag:' + issued)) });
  }
  // Any other number fails, the same way every time.
  return json({ connected: false, outcome: OUTCOMES[parseInt((await sha256(digits)).slice(0, 2), 16) % OUTCOMES.length] });
}

let flagList = null;
async function plant(data, env, ip) {
  onlyKeys(data, ['token', 'colour']);
  const [issuedAt, nonce, strata, signature] = String(data.token ?? '').split('.');
  const issued = Number(issuedAt);
  if (!/^\d{13}$/.test(issuedAt ?? '') || !/^[0-9a-f]{24}$/.test(nonce ?? '') || !/^\d{1,2}$/.test(strata ?? '')
    || !same(await hmac(env.HUNT_KEY, 'flag:' + issuedAt + '.' + nonce + '.' + strata), signature)) throw new HttpError(403, 'bad_token');
  if (Date.now() - issued > TOKEN_AGE || issued > Date.now() + 60_000) throw new HttpError(403, 'token_expired');
  const colour = String(data.colour ?? '');
  if (!COLOURS.includes(colour)) throw new HttpError(400, 'bad_colour');
  const now = Date.now();
  // One statement, so two requests at once cannot both slip under the daily limit. A used token is caught by the
  // WHERE clause rather than by the UNIQUE constraint, because a refused upsert would still use up a flag number.
  const row = await env.DB.prepare('INSERT INTO flags (planted_at, colour, ip_hash, token, strata) SELECT ?, ?, ?, ?, ? '
    + 'WHERE NOT EXISTS (SELECT 1 FROM flags WHERE token = ?) AND (SELECT COUNT(*) FROM flags WHERE ip_hash = ? AND planted_at > ?) < ? '
    + 'ON CONFLICT (token) DO NOTHING RETURNING number')
    .bind(now, colour, ip, nonce, Number(strata), nonce, ip, now - day, FLAGS_DAILY).first();
  if (!row) {
    const used = await env.DB.prepare('SELECT 1 AS used FROM flags WHERE token = ?').bind(nonce).first();
    throw used ? new HttpError(409, 'already_planted') : new HttpError(429, 'enough_flags_today');
  }
  flagList = null;
  log('flag_planted', { number: row.number, strata: Number(strata) });
  return json({ number: row.number, date: now, colour, strata: Number(strata) }, 201);
}

// The newest thousand flags, oldest first. Kept for half a minute; a new flag clears it.
async function flags(env) {
  if (!flagList || Date.now() - flagList.at > 30_000) {
    const { results } = await env.DB.prepare('SELECT number, planted_at, colour, strata FROM flags ORDER BY number DESC LIMIT 1000').all();
    flagList = { at: Date.now(), flags: results.reverse().map(row => ({ number: row.number, date: row.planted_at, colour: row.colour, strata: row.strata })) };
  }
  return json({ flags: flagList.flags });
}

// The early pages count their visitors, as they did. A visitor who reloads in a hurry is shown the count, not added.
async function counter(url, env, ip) {
  const year = Number(url.searchParams.get('year'));
  if (!COUNTED_YEARS.includes(year)) return failure(400, 'bad_year');
  const row = (await allowed(env.COUNTER_LIMIT, ip + ':' + year))
    ? await env.DB.prepare('UPDATE counters SET hits = hits + 1 WHERE year = ? RETURNING hits').bind(year).first()
    : await env.DB.prepare('SELECT hits FROM counters WHERE year = ?').bind(year).first();
  return json({ year, count: row.hits });
}
