const endpoint = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
export const turnstileAction = 'guestbook';

// Server-side check of a Turnstile token. The widget alone proves nothing; only Siteverify does. Tokens are single use
// and expire after five minutes. Network or service errors throw so the caller fails closed.
export async function verifyTurnstile(token, ip, env) {
  if (typeof token !== 'string' || !token || token.length > 2048) return { ok: false, reason: 'missing' };
  if (!env.TURNSTILE_SECRET_KEY) throw new Error('TURNSTILE_SECRET_KEY is not configured.');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: env.TURNSTILE_SECRET_KEY, response: token, remoteip: ip || undefined, idempotency_key: crypto.randomUUID() }),
    signal: AbortSignal.timeout(5000)
  });
  if (!response.ok) throw new Error('Siteverify returned ' + response.status);
  const result = await response.json();
  if (result.success !== true) return { ok: false, reason: 'rejected' };
  // A token solved on another site, or for another form, is not valid here.
  if (result.hostname !== env.TURNSTILE_HOSTNAME) return { ok: false, reason: 'hostname' };
  if (result.action !== turnstileAction) return { ok: false, reason: 'action' };
  return { ok: true };
}
