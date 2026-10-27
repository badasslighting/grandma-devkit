# Hosting the object trees on Cloudflare Pages

map.badass.lighting uses Turnstile to grant anonymous access for seven days. No Google login is needed. Both pages and tree data require a server-side session.

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

The independent optional form requires email, explicit unchecked consent, and a newsletter-specific Turnstile token. It stores email and consent time in newsletter_signups. It never grants or blocks tree access. No emails are sent by this code. Addresses are self-reported; use confirmed opt-in in your mailing service before sending campaigns.

Export newsletter_signups for new signups. Historical Google users remain in users and are handled by export-users.js. Remove unsubscribed addresses from newsletter_signups and any mailing service. The privacy notice provides the contact address for removal requests.

## Operations

- /logout removes the current anonymous and legacy sessions and their cookies.
- Expired anonymous sessions are pruned on new verification.
- Keep rate limiting on /login and /auth/start; also cover /auth/newsletter.
- Run node --test test/siteAuth.test.js for focused authentication and consent tests.
- Use Cloudflare test keys only in an isolated local/preview environment, never production.
