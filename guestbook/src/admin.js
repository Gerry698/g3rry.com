// Moderation Worker on admin.g3rry.com, behind Cloudflare Access. Every request, including the page itself,
// must carry a valid Access token for an allow-listed email; the check happens here, not only at the edge.
import ui from '../build/admin-ui.js';
import { verifyAccess } from './lib/access.js';
import { HttpError, failure, json, log, onlyKeys, readJson, sameOrigin } from './lib/http.js';
import { validateReply } from './lib/text.js';

const day = 24 * 60 * 60 * 1000;
const pageSize = 50;
const banDays = 30;
const cursorPattern = /^(\d{1,15})_([0-9a-f]{32})$/;
const views = { pending: ['pending'], approved: ['approved'], hidden: ['rejected', 'spam'] };
const statusFor = { approve: 'approved', reject: 'rejected', spam: 'spam' };

// The admin page loads only its own script and styles, cannot be framed, and Trusted Types makes the browser
// refuse HTML-string sinks such as innerHTML, so note text can only ever be inserted as text.
const pageHeaders = {
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; require-trusted-types-for 'script'; trusted-types 'none'",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Cache-Control': 'no-store'
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.origin !== env.ADMIN_ORIGIN) return failure(404, 'not_found');
    let user;
    try {
      user = await verifyAccess(request, env);
    } catch (error) {
      log('error', { message: String(error?.message ?? error).slice(0, 200) });
      return failure(503, 'access_unavailable');
    }
    if (!user) {
      log('admin_denied');
      return failure(403, 'forbidden');
    }
    try {
      if (request.method === 'GET') {
        const file = ui[url.pathname];
        if (file) return new Response(file.body, { headers: { ...pageHeaders, 'Content-Type': file.type } });
        if (url.pathname === '/api/summary') return await summary(env, user);
        if (url.pathname === '/api/entries') return await listEntries(url, env);
        return failure(404, 'not_found');
      }
      if (request.method === 'POST') {
        if (!sameOrigin(request, env.ADMIN_ORIGIN)) return failure(403, 'forbidden_origin');
        const data = await readJson(request, 8 * 1024);
        const action = /^\/api\/entries\/([0-9a-f]{32})\/(approve|reject|spam|delete|reply)$/.exec(url.pathname);
        if (action) return await moderate(action[1], action[2], data, env, user);
        if (url.pathname === '/api/settings') return await updateSettings(data, env, user);
        if (url.pathname === '/api/pending/spam') return await spamAllPending(data, env, user);
        return failure(404, 'not_found');
      }
      return failure(405, 'method_not_allowed', { Allow: 'GET, POST' });
    } catch (error) {
      if (error instanceof HttpError) return failure(error.status, error.code);
      log('error', { message: String(error?.message ?? error).slice(0, 200) });
      return failure(500, 'server_error');
    }
  },

  async scheduled(controller, env) {
    const now = controller.scheduledTime ?? Date.now();
    await purgeExpired(env, now);
    await sendDigest(env);
  }
};

async function summary(env, user) {
  const [counts, open] = await env.DB.batch([
    env.DB.prepare('SELECT status, COUNT(*) AS n FROM entries GROUP BY status'),
    env.DB.prepare("SELECT value FROM settings WHERE key = 'submissions_open'")
  ]);
  const byStatus = Object.fromEntries(counts.results.map(row => [row.status, row.n]));
  return json({
    user: user.email,
    open: open.results[0]?.value === '1',
    counts: { pending: byStatus.pending ?? 0, approved: byStatus.approved ?? 0, hidden: (byStatus.rejected ?? 0) + (byStatus.spam ?? 0) }
  });
}

async function listEntries(url, env) {
  const statuses = views[url.searchParams.get('view') ?? 'pending'];
  if (!statuses) return failure(400, 'bad_view');
  const cursorText = url.searchParams.get('cursor');
  const cursor = cursorText === null ? null : cursorPattern.exec(cursorText);
  if (cursorText !== null && !cursor) return failure(400, 'bad_cursor');
  const now = Date.now();
  const placeholders = statuses.map((_, index) => '?' + (index + 4)).join(', ');
  const { results } = await env.DB.prepare(`
    SELECT e.id, e.created_at, e.name, e.body, e.status, e.flags, e.reviewed_at, e.reply, e.reply_at, e.country,
      substr(e.ip_hash, 1, 8) AS ip,
      CASE WHEN e.ip_hash IS NULL THEN 0 ELSE (SELECT COUNT(*) FROM entries o WHERE o.ip_hash = e.ip_hash) END AS ip_count,
      EXISTS (SELECT 1 FROM bans b WHERE b.ip_hash = e.ip_hash AND b.until > ?3) AS banned
    FROM entries e
    WHERE e.status IN (${placeholders}) AND (?1 IS NULL OR e.created_at < ?1 OR (e.created_at = ?1 AND e.id < ?2))
    ORDER BY e.created_at DESC, e.id DESC LIMIT ${pageSize + 1}`)
    .bind(cursor ? Number(cursor[1]) : null, cursor ? cursor[2] : '', now, ...statuses).all();
  const page = results.slice(0, pageSize);
  const last = page.at(-1);
  return json({
    entries: page.map(row => ({
      id: row.id, date: row.created_at, name: row.name, message: row.body, status: row.status,
      flags: row.flags ? row.flags.split(',') : [], reviewed: row.reviewed_at, country: row.country,
      ip: row.ip, ipCount: row.ip_count, banned: Boolean(row.banned),
      reply: row.reply ? { message: row.reply, date: row.reply_at } : null
    })),
    next: results.length > pageSize ? last.created_at + '_' + last.id : null
  });
}

async function moderate(id, action, data, env, user) {
  onlyKeys(data, action === 'spam' ? ['ban'] : action === 'reply' ? ['reply'] : []);
  const entry = await env.DB.prepare('SELECT ip_hash FROM entries WHERE id = ?').bind(id).first();
  if (!entry) return failure(404, 'not_found');
  const now = Date.now();
  const audit = name => env.DB.prepare('INSERT INTO audit (at, actor, action, entry_id) VALUES (?, ?, ?, ?)').bind(now, user.email, name, id);
  const statements = [];
  const result = { ok: true };
  if (action === 'delete') {
    statements.push(env.DB.prepare('DELETE FROM entries WHERE id = ?').bind(id), audit('delete'));
  } else if (action === 'reply') {
    const reply = validateReply(data.reply);
    if (reply === null) return failure(422, 'invalid_reply');
    statements.push(env.DB.prepare('UPDATE entries SET reply = ?, reply_at = ? WHERE id = ?').bind(reply || null, reply ? now : null, id), audit(reply ? 'reply' : 'remove_reply'));
    // The page shows the reply exactly as stored, after the same normalization visitor text gets.
    result.reply = reply;
  } else {
    if (data.ban !== undefined && typeof data.ban !== 'boolean') return failure(400, 'bad_request');
    statements.push(env.DB.prepare('UPDATE entries SET status = ?, reviewed_at = ? WHERE id = ?').bind(statusFor[action], now, id), audit(action));
    if (data.ban && entry.ip_hash) {
      statements.push(
        env.DB.prepare('INSERT INTO bans (ip_hash, until, created_at) VALUES (?, ?, ?) ON CONFLICT (ip_hash) DO UPDATE SET until = excluded.until')
          .bind(entry.ip_hash, now + banDays * day, now),
        audit('ban'));
    }
    // After 30 days the address hash is gone, so there is nothing left to ban; the page says so.
    if (data.ban) result.banned = Boolean(entry.ip_hash);
  }
  await env.DB.batch(statements);
  return json(result);
}

// For a spam wave: every unreviewed note becomes spam at once. They stay restorable from the hidden view for 30 days.
async function spamAllPending(data, env, user) {
  onlyKeys(data, []);
  const now = Date.now();
  const [update] = await env.DB.batch([
    env.DB.prepare("UPDATE entries SET status = 'spam', reviewed_at = ? WHERE status = 'pending'").bind(now),
    env.DB.prepare("INSERT INTO audit (at, actor, action, entry_id) VALUES (?, ?, 'spam_all_pending', NULL)").bind(now, user.email)
  ]);
  return json({ ok: true, count: update.meta.changes });
}

async function updateSettings(data, env, user) {
  onlyKeys(data, ['open']);
  if (typeof data.open !== 'boolean') return failure(400, 'bad_request');
  await env.DB.batch([
    env.DB.prepare("UPDATE settings SET value = ? WHERE key = 'submissions_open'").bind(data.open ? '1' : '0'),
    env.DB.prepare('INSERT INTO audit (at, actor, action, entry_id) VALUES (?, ?, ?, NULL)').bind(Date.now(), user.email, data.open ? 'open' : 'close')
  ]);
  return json({ ok: true, open: data.open });
}

// Retention: address hashes and countries go after 30 days, hidden notes 30 days after review,
// expired bans immediately, and the audit trail after 180 days. Approved notes stay until deleted.
async function purgeExpired(env, now) {
  await env.DB.batch([
    env.DB.prepare('UPDATE entries SET ip_hash = NULL, country = NULL WHERE created_at < ? AND (ip_hash IS NOT NULL OR country IS NOT NULL)').bind(now - 30 * day),
    env.DB.prepare("DELETE FROM entries WHERE status IN ('rejected', 'spam') AND reviewed_at < ?").bind(now - 30 * day),
    env.DB.prepare('DELETE FROM bans WHERE until < ?').bind(now),
    env.DB.prepare('DELETE FROM audit WHERE at < ?').bind(now - 180 * day)
  ]);
}

const digestSize = 20;
// Visitor text in the email is one quoted line per note, so it cannot imitate the email's own text or links.
const quoted = text => {
  const characters = [...text.replace(/\s*\n\s*/g, ' / ')];
  return '> ' + (characters.length > 240 ? characters.slice(0, 240).join('') + '…' : characters.join(''));
};

// One summary email per run (every 15 minutes) at most, and only when something new is waiting,
// so a burst of spam cannot flood the owner's inbox.
async function sendDigest(env) {
  const [fresh, total] = await env.DB.batch([
    env.DB.prepare(`SELECT id, name, body, flags, created_at FROM entries WHERE status = 'pending' AND notified = 0 ORDER BY created_at LIMIT ${digestSize}`),
    env.DB.prepare("SELECT COUNT(*) AS n FROM entries WHERE status = 'pending' AND notified = 0")
  ]);
  const count = total.results[0].n;
  if (!count) return;
  if (!env.NOTIFY_TO || !env.EMAIL) {
    log('digest', { outcome: 'not_configured' });
    return;
  }
  const lines = [
    (count === 1 ? 'A new note is waiting' : count + ' new notes are waiting') + ' for review: ' + env.ADMIN_ORIGIN + '/',
    'Lines starting with ">" are visitor text, not links from the guestbook.',
    ''
  ];
  for (const row of fresh.results) {
    const time = new Date(row.created_at).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
    lines.push(time + (row.flags ? ' [' + row.flags + ']' : ''), quoted('From: ' + row.name), quoted(row.body), '');
  }
  if (count > fresh.results.length) lines.push((count - fresh.results.length) + ' more will follow in the next email.');
  // The subject is fixed text; visitor text only ever appears in the plain-text body.
  await env.EMAIL.send({
    // A display name, because mail from a bare address scores worse with spam filters.
    from: { email: env.NOTIFY_FROM, name: 'g3rry.com guestbook' },
    to: env.NOTIFY_TO,
    subject: count === 1 ? 'Guestbook: 1 new note' : 'Guestbook: ' + count + ' new notes',
    text: lines.join('\n')
  });
  // Only the notes actually listed are marked, so a note that arrives while this runs is not skipped.
  const ids = fresh.results.map(row => row.id);
  await env.DB.prepare('UPDATE entries SET notified = 1 WHERE id IN (' + ids.map(() => '?').join(', ') + ')').bind(...ids).run();
  log('digest', { outcome: 'sent', count: ids.length });
}
