// The Atlas Inbox on this computer: the same page as the claude.ai Artifact, served from 127.0.0.1 with its storage on
// disk. Camera originals are kept byte for byte (EXIF and GPS included, no 20 MB limit); /phantom-publish reads them here.
//   node tools/atlas-inbox/local.mjs            (or the desktop shortcut, which runs open-inbox.cmd)
// Storage: ATLAS_INBOX_DIR, else D:\Claude\g3rry.com-inbox
//   blobs/<id>.<ext>          the files exactly as chosen
//   submissions/<id>.json     one per submission, the same fields as the Artifact's `submissions` collection
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, readdir, rm, rename } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { randomBytes } from 'node:crypto';
import { exec } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const store = process.env.ATLAS_INBOX_DIR || 'D:\\Claude\\g3rry.com-inbox';
const port = Number(process.env.ATLAS_INBOX_PORT || 4190);
const blobs = path.join(store, 'blobs'), submissions = path.join(store, 'submissions');
await mkdir(blobs, { recursive: true });
await mkdir(submissions, { recursive: true });

const types = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/heic': '.heic', 'image/heif': '.heif' };
const mime = Object.fromEntries(Object.entries(types).map(([type, ext]) => [ext, type]));
const newId = () => new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + randomBytes(5).toString('hex');
const safe = id => /^[0-9a-z-]{6,40}$/.test(id) ? id : null;
const send = (response, status, body, type = 'application/json; charset=utf-8') => {
  response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  response.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
};
const readJson = async request => { let text = ''; for await (const chunk of request) text += chunk; return JSON.parse(text || '{}'); };
async function writeSubmission(id, body) {
  const file = path.join(submissions, id + '.json');
  await writeFile(file + '.tmp', JSON.stringify(body, null, 2) + '\n');
  await rename(file + '.tmp', file);
}
async function allSubmissions() {
  const items = [];
  for (const name of await readdir(submissions)) {
    if (!name.endsWith('.json')) continue;
    try { items.push({ id: name.slice(0, -5), ...JSON.parse(await readFile(path.join(submissions, name), 'utf8')) }); } catch {}
  }
  return items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

// The page asks `window.claude.use('db' | 'assets' | 'user')`; this stand-in answers with the local store.
const shim = `<script>
(() => {
window.claude = { use: async name => name === 'user' ? { name: 'local' } : name === 'assets' ? assets : name === 'db' ? db : null };
const call = async (method, url, body, type) => {
  const response = await fetch(url, { method, body, headers: type ? { 'content-type': type } : {} });
  const data = response.headers.get('content-type')?.includes('json') ? await response.json() : null;
  if (!response.ok) throw Object.assign(new Error(data?.error || response.statusText), { code: data?.error || String(response.status) });
  return data;
};
const assets = {
  upload: (blob, { type } = {}) => call('POST', '/api/blobs', blob, type || blob.type || 'application/octet-stream'),
  delete: id => call('DELETE', '/api/blobs/' + encodeURIComponent(id))
};
const doc = id => ({
  get: async () => { const data = await call('GET', '/api/submissions/' + id).catch(() => null); return { exists: Boolean(data), data: () => data }; },
  update: patch => call('PATCH', '/api/submissions/' + id, JSON.stringify(patch), 'application/json'),
  delete: () => call('DELETE', '/api/submissions/' + id)
});
const query = {
  orderBy: () => query, limit: () => query,
  onSnapshot(next, fail) {
    let last = '';
    const poll = async () => {
      try {
        const items = await call('GET', '/api/submissions');
        const text = JSON.stringify(items);
        if (text !== last) { last = text; next({ metadata: { fromCache: false }, docs: items.map(({ id, ...data }) => ({ id, data: () => data })) }); }
      } catch (error) { fail && fail({ code: 'offline' }); }
    };
    poll();
    const timer = setInterval(poll, 2000);
    return () => clearInterval(timer);
  }
};
const db = { collection: () => ({ add: body => call('POST', '/api/submissions', JSON.stringify(body), 'application/json'), doc, ...query }) };
window.ATLAS_INBOX_LOCAL = true;
})();
</script>
`;
async function page() {
  let html = await readFile(path.join(here, 'inbox.html'), 'utf8');
  const swaps = [
    ['const MAX_UPLOAD = 20 * 1024 * 1024', 'const MAX_UPLOAD = Infinity'],
    ['超过 20 MB 的原图会先在本机缩到 3200 px 再上传，焦距、光圈、时间和 GPS 先读出来记下。', '原图原样存在本机（' + store + '），EXIF 和 GPS 都保留，没有大小限制。'],
    ['<script>', shim + '<script>']
  ];
  for (const [from, to] of swaps) {
    if (!html.includes(from)) throw new Error('inbox.html changed; update local.mjs: ' + from.slice(0, 40));
    html = html.replace(from, to);
  }
  return html.replace(/<title>([^<]*)<\/title>/, '<title>$1 · 本机</title>');
}

const server = createServer(async (request, response) => {
  try {
    // Only this computer's pages may call the API.
    const origin = request.headers.origin;
    if (origin && origin !== 'http://127.0.0.1:' + port && origin !== 'http://localhost:' + port) return send(response, 403, { error: 'origin' });
    const url = new URL(request.url, 'http://127.0.0.1');
    const parts = url.pathname.split('/').filter(Boolean);
    if (request.method === 'GET' && url.pathname === '/') return send(response, 200, await page(), 'text/html; charset=utf-8');
    if (parts[0] === '_blob' && parts[1] && request.method === 'GET') {
      const name = (await readdir(blobs)).find(file => file.startsWith(parts[1] + '.'));
      if (!name || !safe(parts[1])) return send(response, 404, { error: 'not_found' });
      response.writeHead(200, { 'content-type': mime[path.extname(name)] || 'application/octet-stream', 'cache-control': 'max-age=3600' });
      return createReadStream(path.join(blobs, name)).pipe(response);
    }
    if (parts[0] !== 'api') return send(response, 404, { error: 'not_found' });
    if (parts[1] === 'blobs' && request.method === 'POST') {
      const id = newId(), ext = types[(request.headers['content-type'] || '').split(';')[0]] || '.bin';
      await pipeline(request, createWriteStream(path.join(blobs, id + ext)));
      return send(response, 200, { id, url: '/_blob/' + id });
    }
    if (parts[1] === 'blobs' && request.method === 'DELETE' && safe(parts[2])) {
      for (const name of await readdir(blobs)) if (name.startsWith(parts[2] + '.')) await rm(path.join(blobs, name), { force: true });
      return send(response, 200, {});
    }
    if (parts[1] === 'submissions' && !parts[2]) {
      if (request.method === 'GET') return send(response, 200, await allSubmissions());
      if (request.method === 'POST') {
        const id = newId(), body = await readJson(request);
        await writeSubmission(id, { ...body, source: 'local' });
        return send(response, 200, { id });
      }
    }
    const id = safe(parts[2] || ''), file = id && path.join(submissions, id + '.json');
    if (parts[1] === 'submissions' && id) {
      const current = await readFile(file, 'utf8').then(JSON.parse).catch(() => null);
      if (!current) return send(response, 404, { error: 'not_found' });
      if (request.method === 'GET') return send(response, 200, current);
      if (request.method === 'PATCH') { await writeSubmission(id, { ...current, ...(await readJson(request)) }); return send(response, 200, {}); }
      if (request.method === 'DELETE') { await rm(file, { force: true }); return send(response, 200, {}); }
    }
    send(response, 405, { error: 'method' });
  } catch (error) {
    console.error(error);
    send(response, 500, { error: 'server' });
  }
});

const address = 'http://127.0.0.1:' + port + '/';
const open = () => exec((process.platform === 'win32' ? 'start "" ' : process.platform === 'darwin' ? 'open ' : 'xdg-open ') + '"' + address + '"');
server.on('error', error => {
  // Already running (another shortcut click): just show it.
  if (error.code === 'EADDRINUSE') { if (!process.argv.includes('--no-open')) open(); setTimeout(() => process.exit(0), 500); return; }
  throw error;
});
server.listen(port, '127.0.0.1', async () => {
  const size = (await readdir(blobs)).length;
  console.log('Atlas Inbox (本机): ' + address + '\n存储: ' + store + '（' + size + ' 个文件）\n关掉这个窗口就停止。');
  if (!process.argv.includes('--no-open')) open();
});
