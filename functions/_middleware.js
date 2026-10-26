import { currentUser, withHeaders } from './_lib.js';

// Everything except the sign-in routes needs a valid session.
const OPEN = [/^\/login\/?$/, /^\/auth\//, /^\/logout\/?$/];

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  if (OPEN.some(re => re.test(url.pathname))) return withHeaders(await next());
  const user = await currentUser(request, env);
  if (!user) {
    if (request.method === 'GET' && (request.headers.get('Accept') || '').includes('text/html')) {
      return withHeaders(Response.redirect(url.origin + '/login', 302));
    }
    return withHeaders(new Response('Sign in required', { status: 401 }));
  }
  context.data.user = user;
  return withHeaders(await next());
}
