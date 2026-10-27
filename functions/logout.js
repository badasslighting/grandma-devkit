import { getCookie, sha256, cookie } from './_lib.js';

export async function onRequest({ request, env }) {
  const token = getCookie(request, 'sid');
  const verified = getCookie(request, 'verified');
  if (verified) await env.DB.prepare('DELETE FROM verified_sessions WHERE id = ?').bind(await sha256(verified)).run();
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(await sha256(token)).run();
  const headers = new Headers({ Location: new URL(request.url).origin + '/login' });
  headers.append('Set-Cookie', cookie('sid', '', 0));
  headers.append('Set-Cookie', cookie('verified', '', 0));
  return new Response(null, {
    status: 302,
    headers,
  });
}
