import { esc } from './_lib.js';

export async function onRequestGet({ env, request }) {
  const query = new URL(request.url).searchParams;
  const err = query.get('error');
  const coffee = env.COFFEE_URL ? `<a class="support" href="${esc(env.COFFEE_URL)}" target="_blank" rel="noopener noreferrer">🍺 Buy me a beer!</a>` : '';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>grandMA Object Trees · BLT</title>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
<style>
:root{color-scheme:light dark;--bg:#f6f5f2;--fg:#1c1b19;--card:#fff;--line:#d9d6cf;--acc:#e0b34a;--muted:#625f58}
@media(prefers-color-scheme:dark){:root{--bg:#14161a;--fg:#e8e6e1;--card:#1d2026;--line:#333842;--muted:#aaa9a5}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px 16px;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif}
main{width:min(100%,460px);background:var(--card);border:1px solid var(--line);border-radius:16px;padding:28px}
.brand{font-size:.7rem;letter-spacing:.18em;font-weight:700;color:var(--muted)}h1{font-size:1.8rem;line-height:1.2;margin:12px 0}p{color:var(--muted);font-size:.95rem;margin:0 0 20px}
button,.support{display:block;width:100%;padding:12px;border:0;border-radius:8px;background:var(--acc);color:#17140c;font:600 1rem system-ui;cursor:pointer;text-align:center;text-decoration:none;margin-top:16px}
.support{background:#000;border:1px solid #fff;color:#fff}section{border-top:1px solid var(--line);margin-top:24px;padding-top:20px}h2{font-size:1rem;margin:0 0 8px}small{display:block;color:var(--muted);font-size:.8rem;margin-top:16px}a{color:inherit}.err{color:#d34e3e}label{display:block;font-size:.9rem}input[type=email]{width:100%;padding:10px;margin:8px 0 12px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg)}.opt{display:flex;gap:8px;align-items:flex-start}.opt input{margin-top:4px}.cf-turnstile{min-height:65px}button:focus-visible,a:focus-visible,input:focus-visible{outline:3px solid var(--acc);outline-offset:3px}
</style></head><body><main>
<div class="brand">BADASS LIGHTING TOOLS</div><h1>grandMA Object Trees</h1>
<p>Explore the grandMA2 and grandMA3 object trees. Complete a quick verification to keep this free reference available for everyone. No account needed.</p>
${err ? `<p class="err" role="alert">${esc(err)}</p>` : ''}
<form method="post" action="/auth/start">
<div class="cf-turnstile" data-sitekey="${esc(env.TURNSTILE_SITEKEY)}" data-action="object_tree" data-size="flexible"></div>
<button type="submit">Open the object trees</button></form>
<small>Your verification is remembered for 7 days.</small>
<section><h2>Keep the tools coming</h2><p>If this reference saves you time, you can support its development.</p>${coffee}</section>
<section><h2>BLT updates <span style="font-weight:400">· optional</span></h2>
<p>New tools, releases, and occasional news. Signing up is never required to use the object trees.</p>
${query.get('subscribed') === '1' ? '<p role="status">Thanks — your signup has been saved.</p>' : ''}
<form method="post" action="/auth/newsletter">
<label for="email">Email address</label><input id="email" name="email" type="email" autocomplete="email" maxlength="254" required>
<label class="opt"><input name="consent" type="checkbox" value="1" required> I agree to receive BLT news by email. I can unsubscribe at any time.</label>
<div class="cf-turnstile" data-sitekey="${esc(env.TURNSTILE_SITEKEY)}" data-action="newsletter" data-size="flexible"></div>
<button type="submit">Sign up for updates</button></form></section>
<small><a href="/privacy">Privacy notice</a></small>
</main></body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
