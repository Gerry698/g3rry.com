// Runs both bundled Workers in workerd (via Miniflare) with one shared D1 database. Outbound requests are
// answered locally: a fake Turnstile Siteverify and a fake Access key endpoint; anything else fails.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { Log, LogLevel, Miniflare, Response, convertV4MiniflareOptions } from 'miniflare';
import { ipHash } from '../src/lib/ip.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SITE = 'https://g3rry.com';
export const ADMIN = 'https://admin.g3rry.com';
export const TEAM = 'test-team.cloudflareaccess.com';
export const AUD = 'test-audience';
export const OWNER = 'owner@example.com';
export const PEPPER = 'test-pepper-0123456789abcdef0123456789abcdef';
export const NOTIFY_TO = 'inbox@example.com';
export const day = 24 * 60 * 60 * 1000;

const siteverifyAnswers = {
  good: { success: true, hostname: 'g3rry.com', action: 'guestbook' },
  'other-host': { success: true, hostname: 'evil.example', action: 'guestbook' },
  'other-action': { success: true, hostname: 'g3rry.com', action: 'login' },
  bad: { success: false, 'error-codes': ['invalid-input-response'] }
};

export async function startFixture({ adminVars = {} } = {}) {
  const keys = await generateKeyPair('RS256', { extractable: true });
  const strangerKeys = await generateKeyPair('RS256', { extractable: true });
  const jwk = { ...(await exportJWK(keys.publicKey)), kid: 'key-1', alg: 'RS256', use: 'sig' };
  const siteverify = [];
  const logs = [];
  class CaptureLog extends Log {
    log(message) { logs.push(message); }
  }

  async function outboundService(request) {
    if (request.url === 'https://challenges.cloudflare.com/turnstile/v0/siteverify') {
      const body = await request.json();
      siteverify.push(body);
      if (body.response === 'down') return new Response('unavailable', { status: 503 });
      const answer = body.secret === 'test-secret' ? siteverifyAnswers[body.response] : null;
      return Response.json(answer ?? { success: false, 'error-codes': ['invalid-input-response'] });
    }
    if (request.url === 'https://' + TEAM + '/cdn-cgi/access/certs') return Response.json({ keys: [jwk] });
    return new Response('unexpected outbound request', { status: 599 });
  }

  const shared = { modules: true, compatibilityDate: '2026-10-15', d1Databases: { DB: 'guestbook' }, cache: false, outboundService, stripCfConnectingIp: false };
  const mf = new Miniflare(convertV4MiniflareOptions({
    log: new CaptureLog(LogLevel.INFO),
    workers: [
      {
        ...shared,
        name: 'public',
        routes: ['g3rry.com/api/guestbook*'],
        scriptPath: path.join(root, 'build/public/public.js'),
        ratelimits: {
          SUBMIT_LIMIT: { namespace_id: '1', simple: { limit: 3, period: 60 } },
          READ_LIMIT: { namespace_id: '2', simple: { limit: 60, period: 60 } }
        },
        bindings: { SITE_ORIGIN: SITE, TURNSTILE_HOSTNAME: 'g3rry.com', TURNSTILE_SECRET_KEY: 'test-secret', IP_PEPPER: PEPPER }
      },
      {
        ...shared,
        name: 'admin',
        routes: ['admin.g3rry.com/*'],
        scriptPath: path.join(root, 'build/admin/admin.js'),
        email: { send_email: [{ name: 'EMAIL' }] },
        bindings: {
          ADMIN_ORIGIN: ADMIN, ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ADMIN_EMAILS: ' Owner@Example.com , second@example.com',
          NOTIFY_FROM: 'guestbook@g3rry.com', NOTIFY_TO, ...adminVars
        }
      }
    ]
  }));
  const db = await mf.getD1Database('DB', 'public');
  const migration = await readFile(path.join(root, 'migrations/0001_init.sql'), 'utf8');
  const statements = migration.split('\n').filter(line => !line.trim().startsWith('--')).join('\n').split(/;\s*\n/).map(text => text.trim()).filter(Boolean);
  for (const statement of statements) await db.prepare(statement).run();

  // dispatchFetch routes by hostname like the real edge; Miniflare's own dev-server checks do not apply to it.
  const send = (url, init) => mf.dispatchFetch(url, init);
  const adminWorker = await mf.getWorker('admin');

  async function token(claims = {}, options = {}) {
    const { key = keys.privateKey, kid = 'key-1', issuer = 'https://' + TEAM, audience = AUD, expires = '5m' } = options;
    let jwt = new SignJWT({ email: OWNER, ...claims }).setProtectedHeader({ alg: 'RS256', kid }).setIssuedAt().setIssuer(issuer).setAudience(audience);
    if (expires !== null) jwt = jwt.setExpirationTime(expires);
    return jwt.sign(key);
  }

  // Rate-limit counters persist for the whole run, so each request gets its own address unless a test sets one.
  const randomIp = () => '10.' + [0, 0, 0].map(() => Math.floor(Math.random() * 250)).join('.');

  return {
    mf, db, siteverify, logs, token, strangerKey: strangerKeys.privateKey,
    hash: ip => ipHash(ip, PEPPER),
    list: (query = '', headers = {}) => send(SITE + '/api/guestbook' + query, { headers: { 'CF-Connecting-IP': randomIp(), ...headers } }),
    submit(body, { ip = randomIp(), origin = SITE, headers = {}, raw, cf } = {}) {
      return send(SITE + '/api/guestbook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', 'CF-Connecting-IP': ip, ...(origin ? { Origin: origin } : {}), ...headers },
        body: raw ?? JSON.stringify(body),
        cf
      });
    },
    publicFetch: send,
    adminDirect: (url, init) => adminWorker.fetch(url, init),
    async admin(pathname, { method = 'GET', body, jwt, origin = ADMIN, headers = {}, url } = {}) {
      const access = jwt === undefined ? await token() : jwt;
      return send(url ?? ADMIN + pathname, {
        method,
        headers: {
          ...(access ? { 'Cf-Access-Jwt-Assertion': access } : {}),
          ...(body !== undefined ? { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', ...(origin ? { Origin: origin } : {}) } : {}),
          ...headers
        },
        body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
      });
    },
    scheduled: async time => adminWorker.scheduled({ scheduledTime: new Date(time ?? Date.now()), cron: '*/15 * * * *' }),
    async rows(sql = 'SELECT * FROM entries ORDER BY created_at') {
      return (await db.prepare(sql).all()).results;
    },
    async reset() {
      for (const table of ['entries', 'bans', 'audit']) await db.prepare('DELETE FROM ' + table).run();
      await db.prepare("UPDATE settings SET value = '1' WHERE key = 'submissions_open'").run();
      await mf.purgeCache();
      siteverify.length = 0;
      logs.length = 0;
    },
    async insert(fields) {
      const row = { id: crypto.randomUUID().replaceAll('-', ''), created_at: Date.now(), name: 'Visitor', body: 'Hello there', body_hash: crypto.randomUUID(), status: 'pending', ...fields };
      const columns = Object.keys(row);
      await db.prepare('INSERT INTO entries (' + columns.join(', ') + ') VALUES (' + columns.map(() => '?').join(', ') + ')').bind(...Object.values(row)).run();
      return row;
    }
  };
}

export const note = (overrides = {}) => ({ name: 'Ada', message: 'Lovely photographs, thank you for sharing.', token: 'good', ...overrides });
