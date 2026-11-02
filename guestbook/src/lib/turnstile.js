const endpoint = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
export const turnstileAction = 'guestbook';
// Error codes that mean the visitor's token is bad. Anything else (a wrong secret, a Cloudflare fault) is ours.
const tokenErrors = new Set(['missing-input-response', 'invalid-input-response', 'timeout-or-duplicate']);

// Server-side check of a Turnstile token. The widget alone proves nothing; only Siteverify does. Tokens are single use
// and expire after five minutes. Network, configuration or service errors throw so the caller fails closed.
export async function verifyTurnstile(token, ip, env) {
  if (typeof token !== 'string' || !token || token.length > 2048) return { ok: false, reason: 'missing' };
  if (!env.TURNSTILE_SECRET_KEY) throw new Error('TURNSTILE_SECRET_KEY is not configured.');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: env.TURNSTILE_SECRET_KEY, response: token, remoteip: ip || undefined, idempotency_key: crypto.randomUUID() }),
    signal: AbortSignal.timeout(5000)
  });
  const result = await response.json().catch(() => null);
  const codes = Array.isArray(result?.['error-codes']) ? result['error-codes'].map(String) : [];
  // Siteverify answers some failures with a 4xx status, so the error codes decide whose fault it was.
  const tokenProblem = codes.length > 0 && codes.every(code => tokenErrors.has(code));
  if (!response.ok && !tokenProblem) throw new Error(('Siteverify returned ' + response.status + ' ' + codes.join(',')).trim());
  if (result?.success !== true) {
    if (!tokenProblem && codes.length) throw new Error('Siteverify error ' + codes.join(','));
    return { ok: false, reason: 'rejected' };
  }
  // A token solved on another site, or for another form, is not valid here.
  if (result.hostname !== env.TURNSTILE_HOSTNAME) return { ok: false, reason: 'hostname' };
  if (result.action !== turnstileAction) return { ok: false, reason: 'action' };
  return { ok: true };
}
