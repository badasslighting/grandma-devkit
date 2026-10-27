import { randomToken, sha256, cookie, sameOrigin, SESSION_DAYS } from '../_lib.js';

export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  const fail = message => Response.redirect(url.origin + '/login?error=' + encodeURIComponent(message), 303);
  if (!sameOrigin(request)) return new Response('Invalid origin', { status: 403 });
  let form;
  try { form = await request.formData(); } catch { return fail('Please try verification again.'); }
  const token = form.get('cf-turnstile-response');
  if (typeof token !== 'string' || !token || token.length > 2048) return fail('Please complete the verification.');
  const result = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST', signal: AbortSignal.timeout(10000),
    body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token,
      remoteip: request.headers.get('CF-Connecting-IP') || '' }),
  }).then(r => r.ok ? r.json() : { success: false }).catch(() => ({ success: false }));
  if (!result.success || result.hostname !== url.hostname || result.action !== 'object_tree') {
    return fail('Verification failed or expired. Please try again.');
  }
  const now = Math.floor(Date.now() / 1000);
  // Optional newsletter signup: typing an email is the opt-in. A bad email never blocks access.
  const email = String(form.get('email') || '').trim().toLowerCase();
  if (email && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    await env.DB.prepare('INSERT INTO newsletter_signups (email, consent_at) VALUES (?, ?) ON CONFLICT(email) DO NOTHING')
      .bind(email, now).run().catch(() => {});
  }
  const sid = randomToken();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM verified_sessions WHERE expires <= ?').bind(now),
    env.DB.prepare('INSERT INTO verified_sessions (id, expires) VALUES (?, ?)')
      .bind(await sha256(sid), now + SESSION_DAYS * 86400),
  ]);
  return new Response(null, { status: 303, headers: {
    Location: url.origin + '/', 'Set-Cookie': cookie('verified', sid, SESSION_DAYS * 86400),
  } });
}
