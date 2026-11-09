// Strata, the hunt under g3rry.com, and the hit counters of the early years.
//   POST /api/hunt/check     { id, answer }   is this the answer to that stratum?
//   GET  /api/hunt/trail/:w                    one turn of the long way round (a redirect with a numbered status)
//   POST /api/hunt/dial      { number }        what answers when the modem dials this number
//   POST /api/hunt/flag      { token, colour } plant a flag on the summit (the token comes from the board)
//   GET  /api/hunt/flags                       every flag planted so far
//   GET  /api/counter?year=1996                count one visit to that year
// Mail to the ranger is answered by the email handler below.
import { EmailMessage } from 'cloudflare:email';
import { HttpError, failure, hex, json, log, onlyKeys, readJson, sameOrigin, sha256 } from '../../guestbook/src/lib/http.js';
import { ipHash } from '../../guestbook/src/lib/ip.js';
import { ANSWERS, FINALE, NUDGES } from './answers.js';
import { dmarcPassed, rangerReply } from './mail.js';

const encoder = new TextEncoder();
const COLOURS = ['red', 'orange', 'yellow', 'green', 'blue', 'white'];
const COUNTED_YEARS = [1996, 1999];
const TOKEN_AGE = 2 * 60 * 60 * 1000;
const day = 24 * 60 * 60 * 1000;
const RANGER_DAILY = 3;
const security = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cross-Origin-Resource-Policy': 'same-origin' };

export const normalise = value => String(value ?? '').normalize('NFKD').toUpperCase().replace(/[^A-Z0-9]/g, '');

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
const finale = env => env.TEST_FINALE || FINALE;

const cache = new Map();
async function content(env, key) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.value;
  const row = await env.DB.prepare('SELECT value FROM content WHERE key = ?').bind(key).first();
  if (!row) throw new HttpError(503, 'not_ready');
  const value = JSON.parse(row.value);
  cache.set(key, { at: Date.now(), value });
  return value;
}

async function allowed(limit, key) {
  if (!limit) return true;
  const { success } = await limit.limit({ key });
  return success;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.origin !== env.SITE_ORIGIN) return failure(404, 'not_found');
    try {
      const ip = await ipHash(request.headers.get('CF-Connecting-IP') ?? '', env.IP_PEPPER);
      const route = url.pathname;
      if (route === '/api/counter') return request.method === 'GET' ? await counter(url, env, ip) : failure(405, 'method_not_allowed', { Allow: 'GET' });
      const trailTurn = /^\/api\/hunt\/trail\/([a-z]{1,20})$/.exec(route);
      if (trailTurn) return request.method === 'GET' ? await trail(trailTurn[1], env) : failure(405, 'method_not_allowed', { Allow: 'GET' });
      if (route === '/api/hunt/flags') return request.method === 'GET' ? await flags(env) : failure(405, 'method_not_allowed', { Allow: 'GET' });
      const posts = { '/api/hunt/check': check, '/api/hunt/dial': dial, '/api/hunt/flag': plant };
      if (!posts[route]) return failure(404, 'not_found');
      if (request.method !== 'POST') return failure(405, 'method_not_allowed', { Allow: 'POST' });
      if (!sameOrigin(request, env.SITE_ORIGIN)) return failure(403, 'cross_origin');
      return await posts[route](await readJson(request, 2048), env, ip);
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
      // Only senders whose domain vouches for them (DMARC) get an answer, so a forged sender cannot aim replies at
      // someone else; and each sender gets a few replies a day at most.
      if (!dmarcPassed(message.headers.get('Authentication-Results'))) return log('ranger_unverified');
      const sender = await ipHash('mail:' + message.from.toLowerCase(), env.IP_PEPPER);
      const today = Math.floor(Date.now() / day);
      const row = await env.DB.prepare('INSERT INTO mail_log (sender_hash, day, replies) VALUES (?, ?, 1) ON CONFLICT (sender_hash, day) DO UPDATE SET replies = replies + 1 RETURNING replies')
        .bind(sender, today).first();
      if (row.replies > RANGER_DAILY) return log('ranger_limited');
      const letter = await content(env, 'ranger');
      const raw = rangerReply({
        from: env.RANGER_ADDRESS, to: message.from, subject: letter.subject, text: letter.text, html: letter.html,
        inReplyTo: message.headers.get('Message-ID'), references: message.headers.get('References'),
        id: hex(crypto.getRandomValues(new Uint8Array(12)))
      });
      await message.reply(new EmailMessage(env.RANGER_ADDRESS, message.from, raw));
      log('ranger_replied');
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
  const digest = await hmac(env.HUNT_KEY, id + ':' + answer);
  if (Object.hasOwn(table, id) && same(digest, table[id])) return json({ correct: true });
  const nudge = nudges(env)[digest];
  return json({ correct: false, ...(nudge ? { nudge } : {}) });
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

const OUTCOMES = ['busy', 'no-carrier', 'not-in-service', 'no-answer'];
async function dial(data, env, ip) {
  onlyKeys(data, ['number']);
  const digits = String(data.number ?? '').replace(/\D/g, '');
  if (digits.length < 3 || digits.length > 18) throw new HttpError(400, 'bad_number');
  if (!(await allowed(env.DIAL_LIMIT, ip))) throw new HttpError(429, 'slow_down');
  const local = digits.replace(/^1?800/, '');
  if (same(await hmac(env.HUNT_KEY, 'finale:' + local), finale(env))) {
    const board = await content(env, 'bbs');
    const issued = Date.now() + '.' + hex(crypto.getRandomValues(new Uint8Array(12)));
    log('board_connected');
    return json({ connected: true, board, token: issued + '.' + (await hmac(env.HUNT_KEY, 'flag:' + issued)) });
  }
  // Any other number fails, the same way every time.
  return json({ connected: false, outcome: OUTCOMES[parseInt((await sha256(digits)).slice(0, 2), 16) % OUTCOMES.length] });
}

async function plant(data, env, ip) {
  onlyKeys(data, ['token', 'colour']);
  const [issuedAt, nonce, signature] = String(data.token ?? '').split('.');
  const issued = Number(issuedAt);
  if (!/^\d{13}$/.test(issuedAt ?? '') || !/^[0-9a-f]{24}$/.test(nonce ?? '') || !same(await hmac(env.HUNT_KEY, 'flag:' + issuedAt + '.' + nonce), signature)) throw new HttpError(403, 'bad_token');
  if (Date.now() - issued > TOKEN_AGE || issued > Date.now() + 60_000) throw new HttpError(403, 'token_expired');
  const colour = String(data.colour ?? '');
  if (!COLOURS.includes(colour)) throw new HttpError(400, 'bad_colour');
  const recent = await env.DB.prepare('SELECT COUNT(*) AS count FROM flags WHERE ip_hash = ? AND planted_at > ?').bind(ip, Date.now() - day).first();
  if (recent.count > 0) throw new HttpError(429, 'one_flag_a_day');
  const now = Date.now();
  const row = await env.DB.prepare('INSERT INTO flags (planted_at, colour, ip_hash, token) VALUES (?, ?, ?, ?) ON CONFLICT (token) DO NOTHING RETURNING number')
    .bind(now, colour, ip, nonce).first();
  if (!row) throw new HttpError(409, 'already_planted');
  log('flag_planted', { number: row.number });
  return json({ number: row.number, date: now, colour }, 201);
}

async function flags(env) {
  const { results } = await env.DB.prepare('SELECT number, planted_at, colour FROM flags ORDER BY number LIMIT 1000').all();
  return json({ flags: results.map(row => ({ number: row.number, date: row.planted_at, colour: row.colour })) }, 200, { 'Cache-Control': 'public, max-age=60' });
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
