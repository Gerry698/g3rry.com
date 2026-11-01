const encoder = new TextEncoder();
export const hex = buffer => [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, '0')).join('');
export const sha256 = async text => hex(await crypto.subtle.digest('SHA-256', encoder.encode(text)));

// Entry IDs are 128 random bits: they reveal nothing about order or volume.
export const newId = () => hex(crypto.getRandomValues(new Uint8Array(16)));
export const idPattern = /^[0-9a-f]{32}$/;

export class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin'
};

// API responses are data, never documents: they cannot render, run scripts or be framed even if opened directly.
export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...securityHeaders,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
      ...headers
    }
  });
}
export const failure = (status, error, headers) => json({ error }, status, headers);

// Accepts only a JSON object no larger than maxBytes, counted while streaming (Content-Length can be absent or wrong).
export async function readJson(request, maxBytes) {
  if (!/^application\/json\s*(?:;|$)/i.test(request.headers.get('content-type') ?? '')) throw new HttpError(415, 'unsupported_media_type');
  if (Number(request.headers.get('content-length')) > maxBytes) throw new HttpError(413, 'too_large');
  if (!request.body) throw new HttpError(400, 'bad_json');
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new HttpError(413, 'too_large');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let data;
  try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw new HttpError(400, 'bad_json'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new HttpError(400, 'bad_json');
  return data;
}

export function onlyKeys(data, allowed) {
  if (Object.keys(data).some(key => !allowed.includes(key))) throw new HttpError(400, 'unexpected_field');
}

// Browsers send Origin on every POST made with fetch, and Fetch Metadata where supported. Requiring both to match
// means no other site, including other g3rry.com subdomains, can make a visitor's or the owner's browser post here.
export function sameOrigin(request, origin) {
  if (request.headers.get('origin') !== origin) return false;
  const site = request.headers.get('sec-fetch-site');
  return site === null || site === 'same-origin';
}

// Keeps logs free of note text and addresses: only an event name and a few non-identifying fields.
export function log(event, fields = {}) {
  console.log(JSON.stringify({ event, ...fields }));
}
