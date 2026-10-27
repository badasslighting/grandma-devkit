import { randomToken, sha256, cookie, SESSION_DAYS, trustedFormOrigin } from '../_lib.js';

export async function onRequestPost({ request, env }) {
  const origin = trustedFormOrigin(request);
  if (!origin) return new Response('Invalid origin', { status: 403 });
  const fail = message => Response.redirect(origin + '/login?error=' + encodeURIComponent(message), 303);
  let form;
  try { form = await request.formData(); } catch { return fail('Please try verification again.'); }
  const email = String(form.get('email') || '').trim().toLowerCase();
  const consent = form.get('consent') === '1';
  if (email && (!consent || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    return fail('Enter a valid email and agree to receive BLT updates, or leave email blank for free access.');
  }
  if (!email && consent) return fail('Enter an email address to subscribe, or untick the consent box.');
  const token = form.get('cf-turnstile-response');
  if (typeof token !== 'string' || !token || token.length > 2048) return fail('Please complete the verification.');
  const result = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST', signal: AbortSignal.timeout(10000),
    body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token,
      remoteip: request.headers.get('CF-Connecting-IP') || '' }),
  }).then(r => r.ok ? r.json() : { success: false }).catch(() => ({ success: false }));
  if (!result.success || result.hostname !== new URL(origin).hostname || result.action !== 'object_tree') {
    return fail('Verification failed or expired. Please try again.');
  }
  const now = Math.floor(Date.now() / 1000);
  const sid = randomToken();
  const statements = [
    env.DB.prepare('DELETE FROM verified_sessions WHERE expires <= ?').bind(now),
    env.DB.prepare('INSERT INTO verified_sessions (id, expires) VALUES (?, ?)')
      .bind(await sha256(sid), now + SESSION_DAYS * 86400),
  ];
  if (email) statements.push(env.DB.prepare(
    'INSERT INTO newsletter_signups (email, consent_at) VALUES (?, ?) ON CONFLICT(email) DO NOTHING'
  ).bind(email, now));
  try { await env.DB.batch(statements); }
  catch { return fail('Could not save verification or signup. Please try again; email signup is optional.'); }
  return new Response(null, { status: 303, headers: {
    Location: origin + '/', 'Set-Cookie': cookie('verified', sid, SESSION_DAYS * 86400),
  } });
}
