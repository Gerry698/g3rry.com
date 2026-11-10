// The ranger's reply: one letter written twice, as text/plain and as text/html in a multipart/alternative message.
// Kept free of Workers-only imports so it can be tested in Node.
const encoder = new TextEncoder();
const ascii = text => /^[\x09\x0a\x0d\x20-\x7e]*$/.test(text);
const crlf = text => text.replace(/\r?\n/g, '\r\n');

function base64(text) {
  let binary = '';
  for (const byte of encoder.encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/.{1,76}/g, line => line + '\r\n').trimEnd();
}

// Plain ASCII goes out as 7bit, readable as it is in "Show original"; anything else is base64.
function part(type, body) {
  const plain = ascii(body) && body.split(/\r?\n/).every(line => line.length <= 900);
  return 'Content-Type: ' + type + '; charset=utf-8\r\nContent-Transfer-Encoding: ' + (plain ? '7bit' : 'base64') + '\r\n\r\n' + (plain ? crlf(body) : base64(body));
}

// Header values come from the incoming message; anything that could start a new header line is dropped.
const headerValue = value => String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
// Message IDs are copied into the reply only when they look like one and are short, so no header line can grow past
// the 998 characters SMTP allows.
const messageIds = value => (headerValue(value).match(/<[^<>\s]{1,250}>/g) ?? []);

export function rangerReply({ from, to, subject, text, html, inReplyTo, references, id, date = new Date() }) {
  const boundary = 'ranger-' + id;
  const parent = messageIds(inReplyTo).at(-1);
  const thread = [...messageIds(references), ...(parent ? [parent] : [])].slice(-10).join(' ');
  const headers = [
    'From: The ranger <' + from + '>',
    'To: <' + headerValue(to) + '>',
    'Subject: ' + headerValue(subject),
    'Date: ' + date.toUTCString().replace('GMT', '+0000'),
    'Message-ID: <' + id + '@g3rry.com>',
    ...(parent ? ['In-Reply-To: ' + parent] : []),
    ...(thread ? ['References: ' + thread] : []),
    // RFC 3834: an automatic reply, so other robots do not answer it.
    'Auto-Submitted: auto-replied',
    'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="' + boundary + '"'
  ];
  return headers.join('\r\n') + '\r\n\r\n'
    + 'This is a message in two parts.\r\n\r\n'
    + '--' + boundary + '\r\n' + part('text/plain', text) + '\r\n'
    + '--' + boundary + '\r\n' + part('text/html', html) + '\r\n'
    + '--' + boundary + '--\r\n';
}

// Email Routing prepends its own Authentication-Results header; only that first one is trusted. Quoted strings and
// comments can carry text the sender chose (an envelope address such as "dmarc=pass"@evil.example), so both are
// removed before anything is read. Headers.get joins repeated headers with ", ", so the first header is everything
// before the next "<host>;" that follows a comma. Each result is then one ";"-separated segment that starts with its
// method name.
export function dmarcResult(authenticationResults) {
  let text = String(authenticationResults ?? '').replace(/"(?:[^"\\]|\\.)*"/g, '""');
  for (let previous; previous !== text;) { previous = text; text = text.replace(/\([^()]*\)/g, ' '); }
  const [authserv, ...segments] = text.split(/,\s*(?=[\w.-]+\s*;)/)[0].split(';');
  const dmarc = segments.map(segment => /^\s*dmarc\s*=\s*([a-z]+)\b(.*)$/i.exec(segment)).find(Boolean);
  return {
    authserv: authserv.trim().toLowerCase().slice(0, 60),
    result: dmarc ? dmarc[1].toLowerCase() : 'none',
    headerFrom: dmarc ? (/\bheader\.from\s*=\s*([^\s;]+)/i.exec(dmarc[2])?.[1] ?? '').toLowerCase() : ''
  };
}
export function dmarcPassed(authenticationResults) {
  const { authserv, result } = dmarcResult(authenticationResults);
  return authserv === 'mx.cloudflare.net' && result === 'pass';
}

const domainOf = address => (/@([^@\s>]+)>?\s*$/.exec(String(address ?? '').trim())?.[1] ?? '').toLowerCase();
// The address inside a From header: the last <…> if there is one, else the bare address.
const fromAddress = header => { const value = headerValue(header); return (/<([^<>]*)>\s*$/.exec(value)?.[1] ?? value).trim(); };
const aligned = (a, b) => Boolean(a && b) && (a === b || a.endsWith('.' + b) || b.endsWith('.' + a));

// Whether the ranger should answer at all (RFC 3834: never answer robots, lists or bounces), and whether the sender
// is who they say: DMARC must pass for the From domain, and the envelope sender the reply goes to must belong to that
// same domain. Returns a reason (and a little non-identifying detail for the log) when the answer is no.
export function shouldAnswer(envelopeFrom, headers) {
  const get = name => headers.get(name);
  const sender = String(envelopeFrom ?? '').trim().toLowerCase();
  if (!sender || /^(mailer-daemon|postmaster|no-?reply|bounces?)[@+]/.test(sender)) return { ok: false, reason: 'bounce' };
  const auto = (get('Auto-Submitted') ?? '').trim().toLowerCase();
  if (auto && auto !== 'no') return { ok: false, reason: 'automatic' };
  if (/^(bulk|list|junk)$/i.test((get('Precedence') ?? '').trim()) || get('List-Id') || get('List-Unsubscribe')) return { ok: false, reason: 'list' };
  const dmarc = dmarcResult(get('Authentication-Results'));
  if (dmarc.authserv !== 'mx.cloudflare.net' || dmarc.result !== 'pass') return { ok: false, reason: 'unverified', detail: { authserv: dmarc.authserv, dmarc: dmarc.result } };
  const fromDomain = domainOf(fromAddress(get('From')));
  if (!aligned(fromDomain, dmarc.headerFrom || fromDomain) || !aligned(domainOf(sender), fromDomain)) return { ok: false, reason: 'misaligned' };
  return { ok: true };
}
