import { esc } from './_lib.js';
export function onRequestGet({ env }) {
  const contact = env.CONTACT_EMAIL || 'justin@badass.lighting';
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Privacy · BLT</title>
<style>body{font:16px/1.6 system-ui;max-width:640px;margin:40px auto;padding:0 20px;color:#242424;background:#f6f5f2}a{color:inherit}</style>
<h1>Privacy</h1><p>grandMA Object Trees is run by Badass Lighting Tools (BLT).</p>
<p><b>Access.</b> Cloudflare Turnstile checks that requests are legitimate. After verification, we store a random session identifier in a secure cookie and its hashed value and expiry in our Cloudflare database. Sessions last 7 days. No Google account, name, or email is required.</p>
<p><b>Newsletter.</b> Only if you enter your email in the combined verification form and tick the newsletter consent box (or submit the older newsletter form), we save your email address and the time you agreed to receive BLT updates. Signup is optional and does not affect access. Email addresses submitted through this form are not verified as belonging to the person submitting them.</p>
<p><b>Your choices.</b> To unsubscribe or request deletion of your information, email <a href="mailto:${esc(contact)}">${esc(contact)}</a>. Newsletter records are retained until you request removal. Expired verification records are removed when new sessions are created. Visit <a href="/logout">end session</a> to remove your current access cookie and session.</p>
<p><b>Services.</b> The site and database run on Cloudflare, which also processes requests for security and verification. Support links open Buy Me a Coffee, a separate service with its own privacy practices.</p>
<p><b>Previous sign-ins.</b> Records from the former Google sign-in system have not been deleted by this change. If you used it previously, BLT may still hold your email, name, visit counts and any newsletter consent. You can request their deletion using the address above.</p>
<p><a href="/login">Back to the object trees</a></p></html>`, {headers:{'Content-Type':'text/html; charset=utf-8'}});
}
