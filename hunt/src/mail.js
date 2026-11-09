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

export function rangerReply({ from, to, subject, text, html, inReplyTo, references, id, date = new Date() }) {
  const boundary = 'ranger-' + id;
  const thread = [headerValue(references), headerValue(inReplyTo)].filter(Boolean).join(' ').split(/\s+/).filter(Boolean).slice(-20).join(' ');
  const headers = [
    'From: The ranger <' + from + '>',
    'To: <' + headerValue(to) + '>',
    'Subject: ' + headerValue(subject),
    'Date: ' + date.toUTCString().replace('GMT', '+0000'),
    'Message-ID: <' + id + '@g3rry.com>',
    ...(inReplyTo ? ['In-Reply-To: ' + headerValue(inReplyTo)] : []),
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

// Email Routing prepends its own Authentication-Results header; only that first one is trusted. Headers.get joins
// repeated headers with ", ", so the first header is everything before the next "<host>;" that follows a comma.
export function dmarcPassed(authenticationResults) {
  const first = String(authenticationResults ?? '').split(/,\s*(?=[\w.-]+\s*;)/)[0];
  return /^\s*mx\.cloudflare\.net\s*;/i.test(first) && /\bdmarc=pass\b/i.test(first);
}
