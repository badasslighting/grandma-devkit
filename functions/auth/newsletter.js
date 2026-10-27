export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  const fail = message => Response.redirect(url.origin + '/login?error=' + encodeURIComponent(message), 303);
  if (request.headers.get('Origin') !== url.origin) return new Response('Invalid origin', {status:403});
  let form;
  try { form = await request.formData(); } catch { return fail('Please try signing up again.'); }
  const email = String(form.get('email') || '').trim().toLowerCase();
  if (form.get('consent') !== '1' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('Enter a valid email and tick the newsletter consent box.');
  const token = form.get('cf-turnstile-response');
  if (typeof token !== 'string' || !token || token.length > 2048) return fail('Please complete the newsletter verification.');
  const result = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method:'POST', signal:AbortSignal.timeout(10000),
    body:new URLSearchParams({secret:env.TURNSTILE_SECRET,response:token,remoteip:request.headers.get('CF-Connecting-IP')||''}),
  }).then(r => r.ok ? r.json() : {success:false}).catch(() => ({success:false}));
  if (!result.success || result.hostname !== url.hostname || result.action !== 'newsletter') return fail('Newsletter verification failed or expired. Please try again.');
  try {
    await env.DB.prepare('INSERT INTO newsletter_signups (email, consent_at) VALUES (?, ?) ON CONFLICT(email) DO NOTHING')
      .bind(email, Math.floor(Date.now()/1000)).run();
  } catch { return fail('We could not save your signup. You can still open the object trees above.'); }
  return Response.redirect(url.origin + '/login?subscribed=1', 303);
}
