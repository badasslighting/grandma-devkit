# Hosting the object trees on Cloudflare Pages

Sign-in with Google, a D1 user table, a Turnstile bot check, and everything (including the tree data) behind the session.

## One-time setup

1. **D1 database.** Cloudflare dashboard > Storage & Databases > D1 > Create, name `grandma-devkit-users`. Copy its ID into `database_id` in `wrangler.toml`. In its Console tab, paste and run `schema.sql`.
2. **Turnstile.** Dashboard > Turnstile > Add widget (Managed, your `*.pages.dev` hostname). Put the site key in `TURNSTILE_SITEKEY` in `wrangler.toml`; keep the secret key for step 5.
3. **Google OAuth.** console.cloud.google.com > APIs & Services > OAuth consent screen (External, add the `email`, `profile`, `openid` scopes, publish to Production) > Credentials > Create OAuth client ID > Web application. Authorized redirect URI: `https://<your-site>.pages.dev/auth/callback` (and your custom domain's, if any).
4. **Pages project.** Workers & Pages > Create > Pages > Connect to Git > `badasslighting/grandma-devkit`. Production branch `main`, build command empty, build output directory `data/object-trees`.
5. **Settings > Variables and Secrets** (Production): secrets `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TURNSTILE_SECRET`. Settings > Bindings: add D1 binding `DB` to `grandma-devkit-users`. Redeploy.

## Bot and abuse protection

- Security > Bots: turn on Bot Fight Mode.
- Security > WAF > Rate limiting rules: limit `/auth/start` and `/login` to about 10 requests per minute per IP.
- Settings > Web Analytics: enable for visitor metrics.

## Using it

- User list: sign in as an address in `ADMIN_EMAILS`, open `/admin/users.csv`.
- Block someone: D1 Console, `UPDATE users SET blocked = 1 WHERE email = '...';`
- Sessions last 7 days; `/logout` ends one.
