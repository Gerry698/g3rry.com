import { createRemoteJWKSet, jwtVerify } from 'jose';

let keySet;
let keySetUrl;

// Cloudflare Access signs every request it lets through. Checking that signature here means the admin Worker stays
// closed even if it is ever reached without passing Access (a missing policy, a new route, a workers.dev URL).
export async function verifyAccess(request, env) {
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token) return null;
  if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.ACCESS_TEAM_DOMAIN ?? '') || !env.ACCESS_AUD) throw new Error('Access is not configured.');
  const issuer = 'https://' + env.ACCESS_TEAM_DOMAIN;
  const url = issuer + '/cdn-cgi/access/certs';
  if (url !== keySetUrl) {
    // Keys are fetched by key ID and refreshed when Access rotates them; never hard-coded.
    keySet = createRemoteJWKSet(new URL(url), { timeoutDuration: 5000, cacheMaxAge: 10 * 60 * 1000 });
    keySetUrl = url;
  }
  let payload;
  try {
    ({ payload } = await jwtVerify(token, keySet, {
      issuer, audience: env.ACCESS_AUD, algorithms: ['RS256'], requiredClaims: ['exp', 'iat', 'email'], clockTolerance: 30
    }));
  } catch {
    return null;
  }
  const allowed = (env.ADMIN_EMAILS ?? '').split(',').map(email => email.trim().toLowerCase()).filter(Boolean);
  const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : '';
  return email && allowed.includes(email) ? { email } : null;
}
