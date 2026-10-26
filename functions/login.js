import { esc } from './_lib.js';

export async function onRequestGet({ env, request }) {
  const err = new URL(request.url).searchParams.get('error');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>grandMA Object Trees</title>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
<style>
:root{--bg:#f6f5f2;--fg:#1c1b19;--card:#fff;--line:#d9d6cf;--acc:#b8860b}
@media (prefers-color-scheme:dark){:root{--bg:#14161a;--fg:#e8e6e1;--card:#1d2026;--line:#333842;--acc:#e0b34a}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif}
main{width:min(92vw,380px);background:var(--card);border:1px solid var(--line);border-radius:12px;padding:28px}
h1{font-size:1.25rem;margin:0 0 8px}p{margin:0 0 18px;opacity:.8;font-size:.95rem}
button{width:100%;padding:12px;border:0;border-radius:8px;background:var(--acc);color:#111;font:600 1rem system-ui;cursor:pointer;margin-top:16px}
.err{color:#c0392b;margin-top:12px;font-size:.9rem}small{display:block;margin-top:16px;opacity:.65}
</style></head><body><main>
<h1>grandMA Object Trees</h1><p>Sign in with Google to view the grandMA2 and grandMA3 object trees.</p>
<form method="post" action="/auth/start">
<div class="cf-turnstile" data-sitekey="${esc(env.TURNSTILE_SITEKEY)}"></div>
<button type="submit">Sign in with Google</button></form>
${err ? `<div class="err">${esc(err)}</div>` : ''}
<small>We store your email and name to count visitors. Nothing is shared.</small>
</main></body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
