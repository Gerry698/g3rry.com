// Local hunt API on http://127.0.0.1:7790 (HUNT_PORT overrides) for the preview server. The site's origin is
// SITE (default http://localhost:4173), which the preview proxies /api/hunt* and /api/counter to when HUNT_API is set:
//   node hunt/scripts/dev.mjs                         made-up data: nothing checks out, but every endpoint answers
//   HUNT_PRIVATE=<solution book folder> node ...      the real key and the private seed, for playtesting
// The D1 database is in memory and starts empty on every run.
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { applyMigrations } from './migrate.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const site = process.env.SITE || 'http://localhost:4173';
const port = Number(process.env.HUNT_PORT || 7790);
const privateFolder = process.env.HUNT_PRIVATE;

if (spawnSync(process.execPath, [path.join(root, 'scripts/build.mjs')], { cwd: root, stdio: 'inherit' }).status !== 0) throw new Error('Worker build failed.');
const secrets = privateFolder ? JSON.parse(await readFile(path.join(privateFolder, 'secrets.local.json'), 'utf8'))
  : { HUNT_KEY: 'local-development-key-0123456789abcdef0123456789', IP_PEPPER: 'local-development-pepper-0123456789abcdef' };

const mf = new Miniflare(convertV4MiniflareOptions({
  modules: true, compatibilityDate: '2026-10-15', stripCfConnectingIp: false,
  scriptPath: path.join(root, 'build/index.js'),
  d1Databases: { DB: 'hunt-dev' },
  ratelimits: {
    CHECK_LIMIT: { namespace_id: '1', simple: { limit: 20, period: 60 } },
    DIAL_LIMIT: { namespace_id: '2', simple: { limit: 10, period: 60 } },
    COUNTER_LIMIT: { namespace_id: '3', simple: { limit: 30, period: 60 } }
  },
  bindings: { SITE_ORIGIN: site, RANGER_ADDRESS: 'ranger@g3rry.com', ...secrets }
}));
const db = await mf.getD1Database('DB');
await applyMigrations(db);
const seed = privateFolder ? await readFile(path.join(privateFolder, 'seed.sql'), 'utf8')
  : ["INSERT INTO content (key, value) VALUES ('trail', '[[\"one\",301],[\"two\",302]]')",
    "INSERT INTO content (key, value) VALUES ('bbs', '{\"banner\":[\"(made-up board)\"],\"lines\":[\"Local development.\"]}')",
    "INSERT INTO content (key, value) VALUES ('ranger', '{\"subject\":\"Re\",\"text\":\"t\",\"html\":\"h\"}')"].join(';\n') + ';\n';
for (const statement of seed.split(/;\s*\n/).map(text => text.trim()).filter(Boolean)) await db.prepare(statement).run();

const worker = await mf.getWorker();
http.createServer(async (request, response) => {
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) if (typeof value === 'string') headers.set(name, value);
    headers.set('CF-Connecting-IP', '127.0.0.1');
    const result = await worker.fetch(site + request.url, { method: request.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined, redirect: 'manual' });
    response.writeHead(result.status, Object.fromEntries(result.headers));
    response.end(Buffer.from(await result.arrayBuffer()));
  } catch (error) {
    response.writeHead(502, { 'Content-Type': 'text/plain' }).end(String(error));
  }
}).listen(port, '127.0.0.1', () => console.log('Hunt API for ' + site + ' on http://127.0.0.1:' + port + (privateFolder ? ' (private seed)' : ' (made-up data)')));
const stop = async () => { await mf.dispose(); process.exit(0); };
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
