# Hosting the object trees on Cloudflare Pages

map.badass.lighting uses Turnstile to grant anonymous access for seven days. No Google login is needed. Both pages and tree data require a server-side session. The combined access form has one Turnstile check and optional newsletter email/consent. The public BLT and Badass Lighting logo PNGs are served from data/object-trees/brand/ without requiring a session.

## Deployment

- Pages project: grandma-devkit-trees; repository: badasslighting/grandma-devkit; production branch: main.
- Build output: data/object-trees; Pages Functions: functions/.
- D1 binding DB: grandma-devkit-users.
- Apply migrations-002-verification.sql before deploying. It adds tables without changing historical users or sessions. Fresh installations use schema.sql.
- Keep TURNSTILE_SITEKEY and TURNSTILE_SECRET configured. Allow map.badass.lighting and grandma-devkit-trees.pages.dev in the widget. Tokens are checked server-side for the request hostname and action.
- Set COFFEE_URL to the owner's Buy Me a Coffee profile. The support link is hidden without it.
- CONTACT_EMAIL controls the privacy/unsubscribe contact; default: justin@badass.lighting.
- Google OAuth credentials are no longer used. Existing unexpired Google sessions remain accepted during transition; outstanding callbacks return to verification.

## Newsletter

The combined access form lets visitors leave email and consent blank. If an email is entered, unchecked consent is rejected; verified signup and anonymous-session writes share a D1 batch. The legacy /auth/newsletter endpoint still requires separate Turnstile verification for existing clients. Email opt-in is never required for tree access. No emails are sent by this code. Addresses are self-reported; use confirmed opt-in in your mailing service before sending campaigns.

Export newsletter_signups for new signups. Historical Google users remain in users and are handled by export-users.js. Remove unsubscribed addresses from newsletter_signups and any mailing service. The privacy notice provides the contact address for removal requests.

## Operations

- /logout removes the current anonymous and legacy sessions and their cookies.
- Expired anonymous sessions are pruned on new verification.
- Keep rate limiting on /login and /auth/start; also cover /auth/newsletter.
- POST origin checks accept only the exact trusted https://map.badass.lighting and https://grandma-devkit-trees.pages.dev origins; Referer is used only if Origin is absent. This tolerates Cloudflare request-URL rewriting without disabling CSRF protection.
- Brand assets originated in badasslighting/shared: BLT-Brand/blt-logo.png and badass-logo-1400x600.png.
- Run node --test test/siteAuth.test.js for focused authentication and consent tests.
- Use Cloudflare test keys only in an isolated local/preview environment, never production.
