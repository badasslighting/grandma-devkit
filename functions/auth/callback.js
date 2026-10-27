// Retire outstanding Google OAuth flows; all new access uses Turnstile.
export function onRequestGet({ request }) {
  return Response.redirect(new URL('/login', request.url).href, 302);
}
