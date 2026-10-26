import { getCookie, sha256, cookie } from './_lib.js';

export async function onRequest({ request, env }) {
  const token = getCookie(request, 'sid');
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(await sha256(token)).run();
  return new Response(null, {
    status: 302,
    headers: { Location: new URL(request.url).origin + '/login', 'Set-Cookie': cookie('sid', '', 0) },
  });
}
