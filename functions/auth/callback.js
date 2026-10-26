import { randomToken, sha256, getCookie, cookie, SESSION_DAYS } from '../_lib.js';

const fail = (origin, msg) => Response.redirect(origin + '/login?error=' + encodeURIComponent(msg), 302);

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const origin = url.origin;
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  if (!code || !state || state !== getCookie(request, 'oauth_state')) return fail(origin, 'Sign-in expired, try again');

  const tok = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: origin + '/auth/callback',
      grant_type: 'authorization_code',
    }),
  }).then(r => r.json()).catch(() => ({}));
  if (!tok.id_token) return fail(origin, 'Google sign-in failed' + (tok.error ? ` (${String(tok.error).slice(0, 40)})` : ''));

  // The id_token comes straight from Google's token endpoint over TLS, so its claims are trusted.
  const claims = JSON.parse(atob(tok.id_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  const issuerOk = claims.iss === 'https://accounts.google.com' || claims.iss === 'accounts.google.com';
  if (claims.aud !== env.GOOGLE_CLIENT_ID || !issuerOk || !claims.email_verified) return fail(origin, 'Google account not verified');
  const email = claims.email.toLowerCase();
  const now = Math.floor(Date.now() / 1000);

  await env.DB.prepare(
    `INSERT INTO users (email, name, first_seen, last_seen, visits) VALUES (?, ?, ?, ?, 1)
     ON CONFLICT(email) DO UPDATE SET name = excluded.name, last_seen = excluded.last_seen, visits = visits + 1`
  ).bind(email, claims.name || '', now, now).run();
  const user = await env.DB.prepare('SELECT blocked FROM users WHERE email = ?').bind(email).first();
  if (user.blocked) return fail(origin, 'This account is blocked');

  const sid = randomToken();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires < ?').bind(now),
    env.DB.prepare('INSERT INTO sessions (id, email, expires) VALUES (?, ?, ?)')
      .bind(await sha256(sid), email, now + SESSION_DAYS * 86400),
  ]);

  const headers = new Headers({ Location: origin + '/' });
  headers.append('Set-Cookie', cookie('sid', sid, SESSION_DAYS * 86400));
  headers.append('Set-Cookie', cookie('oauth_state', '', 0));
  return new Response(null, { status: 302, headers });
}
