import { esc } from './_lib.js';

export async function onRequestGet({ env, request }) {
  const query = new URL(request.url).searchParams;
  const err = query.get('error');
  const coffee = env.COFFEE_URL ? `<a class="support" href="${esc(env.COFFEE_URL)}" target="_blank" rel="noopener noreferrer">Buy Me a Coffee</a>` : '';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>grandMA Object Trees · BLT</title><link rel="icon" href="/favicon.ico" sizes="any"><link rel="icon" type="image/png" href="/favicon-32.png"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
<style>
:root{color-scheme:light dark;--bg:#f6f5f2;--fg:#1c1b19;--card:#fff;--line:#d9d6cf;--acc:#e0b34a;--muted:#625f58}
@media(prefers-color-scheme:dark){:root{--bg:#14161a;--fg:#e8e6e1;--card:#1d2026;--line:#333842;--muted:#aaa9a5}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px 16px;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif}
main{width:min(100%,460px);background:var(--card);border:1px solid var(--line);border-radius:16px;padding:28px}
.brand{font-size:.7rem;letter-spacing:.18em;font-weight:700;color:var(--muted)}h1{font-size:1.8rem;line-height:1.2;margin:12px 0}p{color:var(--muted);font-size:.95rem;margin:0 0 20px}
button,.support{display:block;width:100%;padding:12px;border:0;border-radius:8px;background:var(--acc);color:#17140c;font:600 1rem system-ui;cursor:pointer;text-align:center;text-decoration:none;margin-top:16px}
.support{background:#000;border:1px solid #fff;color:#fff}section{border-top:1px solid var(--line);margin-top:24px;padding-top:20px}h2{font-size:1rem;margin:0 0 8px}small{display:block;color:var(--muted);font-size:.8rem;margin-top:16px}a{color:inherit}.err{color:#d34e3e}label{display:block;font-size:.9rem}input[type=email]{width:100%;padding:10px;margin:8px 0 12px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg)}.opt{display:flex;gap:8px;align-items:flex-start}.opt input{margin-top:4px}.cf-turnstile{min-height:65px}button:focus-visible,a:focus-visible,input:focus-visible{outline:3px solid var(--acc);outline-offset:3px}

:root{color-scheme:light;--bg:#f7f3ea;--fg:#24180f;--card:#fffdf8;--line:#e3d9c4;--acc:#c2402f;--muted:#6e5d4c}
body{font-family:Roboto,Arial,sans-serif}
main{width:min(100%,540px);padding:28px}
.logos{display:flex;justify-content:space-between;align-items:center;gap:24px;margin-bottom:22px}
.blt-logo{display:block;object-fit:contain;width:96px;height:96px}
.badass-logo{display:block;object-fit:contain;object-position:center;width:min(62%,245px);height:auto;min-height:76px;background:#111;border-radius:8px;padding:8px}
.brand{font-size:.75rem;color:var(--muted)}
h1{font-size:clamp(1.7rem,6vw,2.3rem);margin:8px 0 16px}
p.intro{margin:0 0 4px}
p.free{margin-bottom:16px;font-weight:600;color:var(--fg)}
.support{margin:0 0 24px;background:#24180f;border:1px solid #24180f;color:#f3ecd6}
button{background:var(--acc);color:#fff}
section.access{margin-top:0;padding-top:20px}
label.opt{display:flex;gap:10px;align-items:flex-start}
label.opt input{flex:none;margin:5px 0 0}
.hint{font-weight:400;color:var(--muted);font-size:.8rem}
p.explainer{font-size:.8rem;margin:8px 0 16px}
.footer{margin-top:24px}
@media(max-width:370px){main{padding:20px}.blt-logo{width:76px;height:76px}.badass-logo{min-height:60px}}
@media(prefers-color-scheme:dark){:root{color-scheme:dark;--bg:#15110d;--fg:#f3ecd6;--card:#1f1913;--line:#3a2f24;--acc:#f06b55;--muted:#b5a58f}button{color:#21150e}.support{background:#24180f;color:#f3ecd6}}
</style></head><body><main>

<div class="logos" aria-label="Badass Lighting Tools and Badass Lighting">
  <img class="blt-logo" src="/brand/blt-logo.png" alt="BLT — Badass Lighting Tools logo" width="96" height="96">
  <img class="badass-logo" src="/brand/badass-logo.png" alt="Badass Lighting logo" width="224" height="96">
</div>
<div class="brand">BADASS LIGHTING TOOLS</div>
<h1>grandMA Object Trees</h1>
<p class="intro">Explore the grandMA2 and grandMA3 object trees.</p>
<p class="intro free">Free reference available for everyone. No account needed.</p>
${coffee}
${err ? `<p class="err" role="alert">${esc(err)}</p>` : ''}
${query.get('subscribed') === '1' ? '<p role="status">Thanks — your signup has been saved.</p>' : ''}
<section class="access"><h2>Open the object trees</h2>
<p>Complete a quick Cloudflare verification for seven days of access. Newsletter signup is optional.</p>
<form method="post" action="/auth/start">
<label for="email">Email address <span class="hint">(optional · BLT updates)</span></label>
<input id="email" name="email" type="email" autocomplete="email" maxlength="254" placeholder="you@example.com">
<label class="opt" for="consent"><input id="consent" name="consent" type="checkbox" value="1">
<span>I agree to the <a href="/privacy">Privacy Policy</a> and consent to receive BLT news by email. I can unsubscribe at any time.</span></label>
<p class="hint explainer">Enter an email and tick the box to subscribe. Leave both blank to access the trees without signing up.</p>
<div class="cf-turnstile" data-sitekey="${esc(env.TURNSTILE_SITEKEY)}" data-action="object_tree" data-size="flexible"></div>
<button type="submit">Open the object trees</button>
</form>
<small>Your verification is remembered for 7 days.</small>
</section>
<small class="footer"><a href="/privacy">Privacy notice</a></small>
<script>
const newsletterEmail = document.getElementById('email');
const newsletterConsent = document.getElementById('consent');
newsletterEmail.addEventListener('input', () => { newsletterConsent.required = newsletterEmail.value.trim().length > 0; });
</script>
</main></body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
