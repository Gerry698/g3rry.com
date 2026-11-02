// Public guestbook API on g3rry.com/api/guestbook: lists approved notes and accepts new ones for review.
// It has no moderation code at all; that lives in the separate, Access-protected admin Worker.
import { HttpError, failure, json, log, newId, onlyKeys, readJson, sameOrigin, sha256 } from './lib/http.js';
import { ipHash } from './lib/ip.js';
import { duplicateKey, noteFlags, validateNote } from './lib/text.js';
import { verifyTurnstile } from './lib/turnstile.js';

const path = '/api/guestbook';
const day = 24 * 60 * 60 * 1000;
const pageSize = 20;
const maxBodyBytes = 16 * 1024;
// Generous per-address cap: campus and mobile networks put many people behind one address.
const dailyLimit = 10;
// Unreviewed notes allowed per address, so one sender cannot fill the shared review queue on their own.
const senderPendingLimit = 3;
// Beyond this many unreviewed notes, new ones are refused, so a spam wave cannot bury real notes or fill the database.
const pendingLimit = 200;
const listMaxAge = 60;
const pinLimit = 3;
const cursorPattern = /^(\d{1,15})_([0-9a-f]{32})$/;
const columns = 'id, created_at, name, body, reply, reply_at, owner';
// Only public fields leave the database: never the address hash, country, flags or review state. `owner` is set
// only for notes written from the admin page, so a visitor cannot earn the owner mark by choosing a name.
const publicEntry = row => ({
  id: row.id, name: row.name, message: row.body, date: row.created_at, owner: row.owner === 1,
  reply: row.reply ? { message: row.reply, date: row.reply_at } : null
});

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // Answer only on the site's own origin and exact path, whatever route or hostname delivered the request.
    if (url.origin !== env.SITE_ORIGIN || url.pathname !== path) return failure(404, 'not_found');
    try {
      if (request.method === 'GET') return await list(request, url, env, ctx);
      if (request.method === 'POST') return await submit(request, env);
      return failure(405, 'method_not_allowed', { Allow: 'GET, POST' });
    } catch (error) {
      if (error instanceof HttpError) return failure(error.status, error.code);
      log('error', { message: String(error?.message ?? error).slice(0, 200) });
      return failure(500, 'server_error');
    }
  }
};

async function submissionsOpen(env) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'submissions_open'").first();
  return row?.value === '1';
}

async function limited(binding, key) {
  return binding ? !(await binding.limit({ key })).success : false;
}

async function list(request, url, env, ctx) {
  const cursorText = url.searchParams.get('cursor');
  const cursor = cursorText === null ? null : cursorPattern.exec(cursorText);
  if (cursorText !== null && !cursor) return failure(400, 'bad_cursor');
  const visitor = await ipHash(request.headers.get('cf-connecting-ip') ?? '', env.IP_PEPPER);
  if (await limited(env.READ_LIMIT, 'read:' + visitor)) return failure(429, 'rate_limited', { 'Retry-After': '60' });

  // The cache key is rebuilt from validated input only, so extra query parameters cannot split the cache. A made-up
  // but well-formed cursor still reaches D1; that costs one indexed range read and is covered by the rate limits.
  const cacheKey = new Request(env.SITE_ORIGIN + path + (cursor ? '?cursor=' + cursorText : ''));
  const cached = await caches.default.match(cacheKey);
  if (cached) {
    // A cache hit comes back with the zone's Browser Cache TTL (4 hours by default) in place of our max-age.
    const hit = new Response(cached.body, cached);
    hit.headers.set('Cache-Control', 'public, max-age=' + listMaxAge);
    return hit;
  }

  const statement = cursor
    ? env.DB.prepare(`SELECT ${columns} FROM entries WHERE status = 'approved' AND (created_at < ?1 OR (created_at = ?1 AND id < ?2)) ORDER BY created_at DESC, id DESC LIMIT ${pageSize + 1}`).bind(Number(cursor[1]), cursor[2])
    : env.DB.prepare(`SELECT ${columns} FROM entries WHERE status = 'approved' ORDER BY created_at DESC, id DESC LIMIT ${pageSize + 1}`);
  // Pinned notes come with the first page, the owner's own first and then pinned visitor notes, newest pin first in
  // each tier. They also stay in their place in `entries`, which is all a page from before pins knows how to show.
  const [{ results }, pins] = await env.DB.batch(cursor ? [statement] : [statement,
    env.DB.prepare(`SELECT ${columns} FROM entries WHERE status = 'approved' AND pinned_at IS NOT NULL ORDER BY owner DESC, pinned_at DESC LIMIT ${pinLimit}`)]);
  const page = results.slice(0, pageSize);
  const last = page.at(-1);
  const data = { entries: page.map(publicEntry), next: results.length > pageSize ? last.created_at + '_' + last.id : null };
  if (!cursor) {
    data.pinned = pins.results.map(publicEntry);
    data.open = await submissionsOpen(env);
  }
  const response = json(data, 200, { 'Cache-Control': 'public, max-age=' + listMaxAge });
  ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
  return response;
}

// Bots get the same answer as people, so a shadow-banned sender or a filled honeypot reveals nothing.
const accepted = () => json({ status: 'pending' }, 202);

async function submit(request, env) {
  if (!sameOrigin(request, env.SITE_ORIGIN)) return failure(403, 'forbidden_origin');
  const ip = request.headers.get('cf-connecting-ip') ?? '';
  const visitor = await ipHash(ip, env.IP_PEPPER);
  if (await limited(env.SUBMIT_LIMIT, 'submit:' + visitor)) return failure(429, 'rate_limited', { 'Retry-After': '60' });

  const data = await readJson(request, maxBodyBytes);
  onlyKeys(data, ['name', 'message', 'extra', 'token']);
  // The "extra" field is hidden from people and named so that browsers and password managers do not autofill it;
  // anything typed into it came from a script.
  if (data.extra !== undefined && data.extra !== '') {
    log('submit', { outcome: 'honeypot' });
    return accepted();
  }
  if (!(await submissionsOpen(env))) return failure(503, 'closed');
  // Validate before Turnstile: its token is single use, so a typo should not cost the visitor a new challenge.
  const note = validateNote(data);
  if (!note.ok) return json({ error: 'invalid', fields: note.errors }, 422);

  let verification;
  try {
    verification = await verifyTurnstile(data.token, ip, env);
  } catch (error) {
    log('turnstile_error', { message: String(error?.message ?? error).slice(0, 200) });
    return failure(503, 'verification_unavailable');
  }
  if (!verification.ok) {
    log('submit', { outcome: 'turnstile_' + verification.reason });
    return failure(403, 'verification_failed');
  }

  const now = Date.now();
  const bodyHash = await sha256(duplicateKey(note.message));
  const [ban, recent, waiting, pending, duplicates] = await env.DB.batch([
    env.DB.prepare('SELECT 1 FROM bans WHERE ip_hash = ? AND until > ?').bind(visitor, now),
    env.DB.prepare('SELECT COUNT(*) AS n FROM entries WHERE ip_hash = ? AND created_at > ?').bind(visitor, now - day),
    env.DB.prepare("SELECT COUNT(*) AS n FROM entries WHERE ip_hash = ? AND status = 'pending'").bind(visitor),
    env.DB.prepare("SELECT COUNT(*) AS n FROM entries WHERE status = 'pending'"),
    env.DB.prepare('SELECT ip_hash FROM entries WHERE body_hash = ? AND created_at > ? LIMIT 50').bind(bodyHash, now - 7 * day)
  ]);
  if (ban.results.length) {
    log('submit', { outcome: 'banned' });
    return accepted();
  }
  if (recent.results[0].n >= dailyLimit) return failure(429, 'daily_limit');
  if (waiting.results[0].n >= senderPendingLimit) return failure(429, 'pending_limit');
  if (duplicates.results.some(row => row.ip_hash === visitor)) return failure(409, 'duplicate');
  if (pending.results[0].n >= pendingLimit) {
    log('submit', { outcome: 'queue_full' });
    return failure(503, 'busy');
  }

  const flags = noteFlags(note.name, note.message);
  if (duplicates.results.length) flags.push('duplicate');
  const country = /^[A-Z0-9]{2}$/.test(request.cf?.country ?? '') ? request.cf.country : null;
  await env.DB.prepare('INSERT INTO entries (id, created_at, name, body, body_hash, flags, ip_hash, country) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(newId(), now, note.name, note.message, bodyHash, flags.join(','), visitor, country).run();
  log('submit', { outcome: 'stored' });
  return accepted();
}
