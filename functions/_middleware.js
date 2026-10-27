import { currentUser, withHeaders } from './_lib.js';

// Tree pages and data require a verified session.
const OPEN = [/^\/login\/?$/, /^\/privacy\/?$/, /^\/auth\//, /^\/logout\/?$/, /^\/brand\/(?:blt-logo|badass-logo)\.png$/];

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  if (OPEN.some(re => re.test(url.pathname))) return withHeaders(await next());
  const user = await currentUser(request, env);
  if (!user) {
    if (request.method === 'GET' && (request.headers.get('Accept') || '').includes('text/html')) {
      return withHeaders(Response.redirect(url.origin + '/login', 302));
    }
    return withHeaders(new Response('Verification required', { status: 401 }));
  }
  context.data.user = user;
  return withHeaders(await next());
}
