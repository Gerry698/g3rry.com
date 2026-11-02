// Local end-to-end preview: the built site on http://localhost:4173 (PORT overrides; its /api/guestbook is proxied to
// the public Worker) and the admin page on http://localhost:8788. Both Workers run in workerd and share a local D1
// database that starts empty on every run.
// Turnstile uses Cloudflare's dummy keys; this script stands in for Siteverify and for Cloudflare Access.
// Build the site first:  GUESTBOOK_SITEKEY=1x00000000000000000000AA npm run build   (in the repository root)
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { Miniflare, Response, convertV4MiniflareOptions } from 'miniflare';
import { applyMigrations } from './migrate.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const site = 'http://localhost:' + Number(process.env.PORT || 4173);
const admin = 'http://localhost:8788';
const team = 'local-dev.cloudflareaccess.com';
const owner = 'owner@localhost.test';

await new Promise((resolve, reject) => {
  spawn(process.execPath, [path.join(root, 'scripts/build.mjs')], { cwd: root, stdio: 'inherit' })
    .once('exit', code => (code === 0 ? resolve() : reject(new Error('Worker build failed.'))));
});

const keys = await generateKeyPair('RS256');
const jwk = { ...(await exportJWK(keys.publicKey)), kid: 'local', alg: 'RS256' };
async function outboundService(request) {
  if (request.url === 'https://challenges.cloudflare.com/turnstile/v0/siteverify') {
    const { response } = await request.json();
    // Tokens from Cloudflare's always-pass dummy site keys.
    const ok = response === 'XXXX.DUMMY.TOKEN.XXXX';
    return Response.json(ok ? { success: true, hostname: '127.0.0.1', action: 'guestbook' } : { success: false });
  }
  if (request.url === 'https://' + team + '/cdn-cgi/access/certs') return Response.json({ keys: [jwk] });
  return new Response('Outbound requests are disabled in local development.', { status: 599 });
}

const shared = { modules: true, compatibilityDate: '2026-10-15', d1Databases: { DB: 'guestbook-dev' }, outboundService, stripCfConnectingIp: false };
const mf = new Miniflare(convertV4MiniflareOptions({
  workers: [
    {
      ...shared, name: 'public', scriptPath: path.join(root, 'build/public/public.js'),
      bindings: { SITE_ORIGIN: site, TURNSTILE_HOSTNAME: '127.0.0.1', TURNSTILE_SECRET_KEY: 'local', IP_PEPPER: 'local-development-pepper-0123456789abcdef' }
    },
    {
      ...shared, name: 'admin', scriptPath: path.join(root, 'build/admin/admin.js'),
      email: { send_email: [{ name: 'EMAIL' }] },
      bindings: { ADMIN_ORIGIN: admin, ACCESS_TEAM_DOMAIN: team, ACCESS_AUD: 'local', ADMIN_EMAILS: owner, NOTIFY_FROM: 'guestbook@g3rry.com', NOTIFY_TO: owner }
    }
  ]
}));

const db = await mf.getD1Database('DB', 'public');
await applyMigrations(db);

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

function serve(port, origin, worker, extraHeaders) {
  http.createServer(async (request, response) => {
    try {
      const headers = new Headers();
      for (const [name, value] of Object.entries(request.headers)) if (typeof value === 'string') headers.set(name, value);
      headers.set('CF-Connecting-IP', '127.0.0.1');
      for (const [name, value] of Object.entries(await extraHeaders())) headers.set(name, value);
      const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await readBody(request);
      const result = await worker.fetch(origin + request.url, { method: request.method, headers, body });
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.end(Buffer.from(await result.arrayBuffer()));
    } catch (error) {
      response.writeHead(502, { 'Content-Type': 'text/plain' }).end(String(error));
    }
  }).listen(port, '127.0.0.1');
}

// Cloudflare Access is simulated by signing a token for the owner on every admin request.
const accessToken = () => new SignJWT({ email: owner }).setProtectedHeader({ alg: 'RS256', kid: 'local' })
  .setIssuer('https://' + team).setAudience('local').setIssuedAt().setExpirationTime('5m').sign(keys.privateKey);
serve(8787, site, await mf.getWorker('public'), async () => ({}));
serve(8788, admin, await mf.getWorker('admin'), async () => ({ 'Cf-Access-Jwt-Assertion': await accessToken() }));

const preview = spawn(process.execPath, [path.resolve(root, '../scripts/preview.mjs')], {
  cwd: path.resolve(root, '..'), stdio: 'inherit', env: { ...process.env, GUESTBOOK_API: 'http://127.0.0.1:8787' }
});
console.log('Site: ' + site + '/guestbook/   Admin: ' + admin + '/   (Ctrl+C stops)');
const stop = async () => {
  preview.kill();
  await mf.dispose();
  process.exit(0);
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
