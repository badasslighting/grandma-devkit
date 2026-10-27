import { esc } from './_lib.js';

// Styled to match licence.badass.lighting (dark stage-lighting look, same logos).
export async function onRequestGet({ env, request }) {
  const err = new URL(request.url).searchParams.get('error');
  const coffee = env.COFFEE_URL ? `<a class="beer" href="${esc(env.COFFEE_URL)}" target="_blank" rel="noopener noreferrer">&#127866; Buy me a beer!</a>` : '';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>grandMA Object Trees · BLT</title>
<link rel="icon" href="/brand/blt-logo.webp">
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
<style>
:root{color-scheme:dark;--bg:#000;--line:#2a2a33;--text:#f3efe8;--dim:#9a96a0;--bun:#e49c3c;--bun2:#c06c24}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;background:var(--bg);color:var(--text);font:16px/1.45 "Helvetica Neue",Helvetica,Arial,sans-serif;overflow-x:hidden}
main{position:relative;z-index:1;max-width:32rem;margin:0 auto;padding:2rem 1rem 3rem}
.brand{display:flex;align-items:center;justify-content:center;gap:1.1rem;margin-bottom:1.4rem}
.brand img{display:block}
.brand .sk{height:92px;width:auto;filter:drop-shadow(0 0 18px rgba(255,255,255,.14))}
.brand .blt{height:84px;width:auto;filter:drop-shadow(0 6px 14px rgba(255,255,255,.12))}
h1{margin:0 0 .15rem;text-align:center;font-size:1.7rem;letter-spacing:.02em}
.sub{margin:0 0 1.4rem;text-align:center;color:var(--dim)}
.card{background:#000;border:1px solid #1c1c22;border-radius:16px;padding:1.4rem}
.card p{margin:0 0 .8rem;color:var(--dim)}.card p.free{color:var(--text);font-weight:600}
.beer{display:block;margin:.2rem 0 1.2rem;padding:.75rem;text-align:center;font-weight:700;color:var(--bun);text-decoration:none;background:#000;border:1px solid var(--bun2);border-radius:11px;transition:.15s}
.beer:hover{filter:brightness(1.15);transform:translateY(-1px)}
label{display:block;margin:.9rem 0 .3rem;font-size:.85rem;color:var(--dim);letter-spacing:.03em}
label small{color:#77737d}
input{width:100%;padding:.65rem .75rem;font:inherit;color:var(--text);background:#000;border:1px solid #2a2a33;border-radius:10px;outline:0;transition:.15s}
input:focus{border-color:var(--bun);box-shadow:0 0 0 3px color-mix(in srgb,var(--bun) 25%,transparent)}
.note{margin:.5rem 0 1rem;color:#77737d;font-size:.8rem}.note a{color:var(--dim)}
.cf-turnstile{min-height:65px}
button.go{width:100%;margin-top:1.2rem;padding:.8rem;font:700 1rem inherit;font-family:inherit;color:#1d0f00;background:linear-gradient(180deg,var(--bun),var(--bun2));border:0;border-radius:11px;cursor:pointer;transition:.15s}
button.go:hover{filter:brightness(1.08);transform:translateY(-1px)}
.err{color:#ff9d94}
.small{margin:.9rem 0 0;color:var(--dim);font-size:.85rem}
footer{margin-top:1.6rem;text-align:center;color:#6f6b76;font-size:.8rem}footer b{color:var(--dim)}footer a{color:inherit}
a:focus-visible,button:focus-visible{outline:3px solid var(--bun);outline-offset:3px}
@media (max-width:420px){.brand .sk{height:72px}.brand .blt{height:66px}}
</style></head><body>
<main>
<div class="brand"><img class="sk" src="/brand/badass-logo.webp" alt="Badass Lighting Co."><img class="blt" src="/brand/blt-logo.webp" alt="Badass Lighting Tools (BLT)"></div>
<h1>grandMA Object Trees</h1>
<p class="sub">grandMA2 &amp; grandMA3 reference</p>
<div class="card">
<p>Explore the full grandMA2 and grandMA3 object trees, mapped (as of now) from grandMA2 3.9.61.1 and grandMA3 2.5.1.0.</p>
<p>Search any object, copy its exact address, and see every property with its type, whether it is read-only, and the values it accepts.</p>
<p>It's built for writing plugins and macros, for those who're tired of guessing paths, class names and enum values.</p>
<p>You can look them up here, copy the paths and paste straight into your Lua or command line!</p>
<p class="free">Free reference available for everyone. No account needed.</p>
${coffee}
${err ? `<p class="err" role="alert">${esc(err)}</p>` : ''}
<form method="post" action="/auth/start">
<label for="email">Email <small>(optional &middot; BLT news &amp; updates)</small></label>
<input id="email" name="email" type="email" autocomplete="email" maxlength="254" placeholder="you@example.com">
<p class="note">Add your email to get occasional BLT news. Leave it blank to just open the trees. Unsubscribe any time &mdash; see the <a href="/privacy">privacy notice</a>.</p>
<div class="cf-turnstile" data-sitekey="${esc(env.TURNSTILE_SITEKEY)}" data-action="object_tree" data-size="flexible" data-theme="dark"></div>
<button class="go" type="submit">Open the object trees</button>
</form>
<p class="small">Your verification is remembered for 7 days.</p>
</div>
<footer><b>Badass Lighting Tools</b> &middot; a Badass Lighting Co. product<br>Not affiliated with or endorsed by MA Lighting. &middot; <a href="/privacy">Privacy</a></footer>
</main>
</body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
