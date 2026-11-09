import http from 'node:http';
import { readFile, stat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const port = Number(process.env.PORT || 4173);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8' };
try { await stat(path.join(root, 'index.html')); } catch { throw new Error('Build the site first with npm run build.'); }
const actualRoot = await realpath(root);
// guestbook/scripts/dev.mjs sets GUESTBOOK_API so the page can reach the local Worker on the same origin, as in production.
const guestbookApi = process.env.GUESTBOOK_API;
async function proxyGuestbook(request, response) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const headers = Object.fromEntries(['content-type', 'accept', 'origin', 'sec-fetch-site'].filter(name => request.headers[name]).map(name => [name, request.headers[name]]));
  const result = await fetch(guestbookApi + request.url, { method: request.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined });
  // fetch() has already decoded the body, so the upstream encoding and length no longer describe it.
  const passed = Object.fromEntries([...result.headers].filter(([name]) => !['content-encoding', 'content-length', 'transfer-encoding'].includes(name)));
  response.writeHead(result.status, passed);
  response.end(Buffer.from(await result.arrayBuffer()));
}
http.createServer(async (request, response) => {
  try {
    if (guestbookApi && new URL(request.url, 'http://localhost').pathname === '/api/guestbook') { await proxyGuestbook(request, response); return; }
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname.includes('\0') || pathname.includes('\\')) { response.writeHead(400).end(); return; }
    let filename = path.resolve(root, '.' + pathname);
    if (!filename.startsWith(root + path.sep) && filename !== root) { response.writeHead(403).end(); return; }
    if ((await stat(filename)).isDirectory()) filename = path.join(filename, 'index.html');
    const actual = await realpath(filename);
    if (!actual.startsWith(actualRoot + path.sep)) { response.writeHead(403).end(); return; }
    const bytes = await readFile(actual);
    response.writeHead(200, { 'Content-Type': types[path.extname(actual).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(request.method === 'HEAD' ? undefined : bytes);
  } catch {
    try {
      const missing = await readFile(path.join(root, '404.html'));
      response.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(request.method === 'HEAD' ? undefined : missing);
    } catch {
      response.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(request.method === 'HEAD' ? undefined : 'The preview is rebuilding. Please reload shortly.');
    }
  }
}).listen(port, '127.0.0.1', () => console.log('Preview: http://127.0.0.1:' + port + ' (dist only)'));
