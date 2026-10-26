import { esc } from './_lib.js';

export async function onRequestGet({ env }) {
  const contact = env.CONTACT_EMAIL
    ? `<p>To see or delete your data, email <a href="mailto:${esc(env.CONTACT_EMAIL)}">${esc(env.CONTACT_EMAIL)}</a>.</p>`
    : '';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Privacy</title>
<style>
:root{--bg:#f6f5f2;--fg:#1c1b19;--acc:#8a6508}
@media (prefers-color-scheme:dark){:root{--bg:#14161a;--fg:#e8e6e1;--acc:#e0b34a}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,sans-serif}
main{max-width:640px;margin:0 auto;padding:32px 16px}a{color:var(--acc)}h1{font-size:1.4rem}
</style></head><body><main>
<h1>Privacy</h1>
<p>grandMA Object Trees is run by Badass Lighting Tools (BLT).</p>
<p><b>What we keep.</b> When you sign in with Google we keep your email address and name, when you first and last signed in, and how many times you have. Your Google password is never shared with us.</p>
<p><b>Why.</b> To let you in, to keep crawlers and bots from using up bandwidth, and to see how many people use the page.</p>
<p><b>Mailing list.</b> If you tick the box on the sign-in page we also record that you agreed, and the date, so we can send you BLT news. You can unsubscribe at any time. If you leave it unticked we won't email you.</p>
<p><b>Who sees it.</b> Only BLT. We don't sell or share it. The page runs on Cloudflare and sign-in uses Google, which handle your data as our service providers.</p>
<p><b>How long.</b> Sign-in sessions last 7 days. Your record stays until you ask us to delete it.</p>
${contact}
<p><a href="/login">Back to sign in</a></p>
</main></body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
