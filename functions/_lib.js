export const SESSION_DAYS = 7;
const enc = new TextEncoder();

const hex = bytes => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');

export function randomToken(bytes = 32) {
  return hex(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256(text) {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text))));
}

export function getCookie(request, name) {
  const m = (request.headers.get('Cookie') || '').match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  try { return m ? decodeURIComponent(m[1]) : null; } catch { return null; }
}

export function cookie(name, value, maxAge) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'private, no-store',
};

export function withHeaders(response) {
  const r = new Response(response.body, response);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) r.headers.set(k, v);
  return r;
}

export async function currentUser(request, env) {
  const verified = getCookie(request, 'verified');
  if (verified && /^[a-f0-9]{64}$/.test(verified)) {
    const session = await env.DB.prepare('SELECT expires FROM verified_sessions WHERE id = ? AND expires > ?')
      .bind(await sha256(verified), Math.floor(Date.now() / 1000)).first();
    if (session) return { verified: true };
  }
  const token = getCookie(request, 'sid');
  if (!token) return null;
  const now = Math.floor(Date.now() / 1000);
  return env.DB.prepare(
    `SELECT u.email, u.name FROM sessions s JOIN users u ON u.email = s.email
     WHERE s.id = ? AND s.expires > ? AND u.blocked = 0`
  ).bind(await sha256(token), now).first();
}

// Referrer-Policy: no-referrer makes browsers send "Origin: null" on same-origin form posts,
// so fall back to Sec-Fetch-Site, which browsers set themselves and pages cannot forge.
export function sameOrigin(request) {
  const origin = request.headers.get('Origin');
  if (origin && origin !== 'null') return origin === new URL(request.url).origin;
  return request.headers.get('Sec-Fetch-Site') === 'same-origin';
}

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ENTITIES[c]);
