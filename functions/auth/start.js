import { randomToken, cookie } from '../_lib.js';

export async function onRequestPost({ request, env }) {
  const origin = new URL(request.url).origin;
  const form = await request.formData();
  const ts = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: new URLSearchParams({
      secret: env.TURNSTILE_SECRET,
      response: form.get('cf-turnstile-response') || '',
      remoteip: request.headers.get('CF-Connecting-IP') || '',
    }),
  }).then(r => r.json()).catch(() => ({ success: false }));
  if (!ts.success) return Response.redirect(origin + '/login?error=' + encodeURIComponent('Bot check failed, try again'), 302);

  const state = randomToken(16);
  const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  auth.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: origin + '/auth/callback',
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account',
  });
  return new Response(null, {
    status: 302,
    headers: { Location: auth.toString(), 'Set-Cookie': cookie('oauth_state', state, 600) },
  });
}
