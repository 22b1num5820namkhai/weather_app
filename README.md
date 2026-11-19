# Weather App

HTML/CSS/JavaScript weather dashboard, Express, MySQL, bcrypt, Google Identity Services, CSRF and MySQL-backed sessions. Existing weather design and Open-Meteo search/background behavior are retained. Login and Register are separate views in the same page; either password or Google login opens the same dashboard.

## Windows setup

1. Install Node.js and MySQL. Keep the existing database and users.
2. If starting from an empty database, run `hereglegch.sql`. For an existing database, run only `backend/migrations/001_google_identities.sql` against `weather_hereglegch` in MySQL Workbench. This additive migration has already been applied to the local database. It never drops users. Sessions are created automatically by the session store.
3. Preserve the existing `backend/.env`. On a new machine copy `backend/.env.example` to `.env` and fill DB settings, SESSION_SECRET (random, at least 32 characters), GOOGLE_CLIENT_ID. Do not commit .env. No Google client secret is needed for this ID-token flow.
4. Run `npm.cmd ci --prefix backend`.
5. Run `npm.cmd start --prefix backend`.
6. Open http://localhost:3000. Restart any old server first so it loads the changed code.
7. Run `npm.cmd test --prefix backend` for automated tests.

If MySQL is stopped or the mapping migration is missing, authentication will fail safely. DB user needs initial table creation permissions and then appropriate SELECT/INSERT/UPDATE/DELETE privileges for users, google_identities and sessions; use a dedicated least-privilege account in deployment.

## Google Cloud configuration

Use an OAuth **Web application** client. Set its client ID in GOOGLE_CLIENT_ID. Configure Authorized JavaScript origins with exact scheme/host/port: `http://localhost:3000` for local development. Add `http://127.0.0.1:3000` only if you actually use that address. For production add your exact HTTPS origin. Origins have no path. Configure the consent screen, audience and test users as required by the Google project settings.

The frontend obtains only the public client ID from `/api/auth/config`, loads the official `https://accounts.google.com/gsi/client` script, and renders Google's Continue with Google button. A JavaScript callback sends its credential to `/api/auth/google`; this popup callback flow does not need an OAuth redirect callback route. Blocked scripts, browser privacy settings, origin errors, or consent configuration may prevent the button from working. Manual browser testing is still required.

## Authentication and sessions

- Password registration uses bcrypt and parameterized SQL. Registration returns to Login without automatically signing in.
- Google ID tokens are verified using google-auth-library (signature, issuer, audience and expiry); the request's Google nonce is bound to its CSRF session token. Verified `sub` maps through google_identities. Email alone never links accounts. If a password account already owns that email, Google login returns 409 and asks for the original login method.
- Google-only users receive a bcrypt hash of an unknown random password. Password login explicitly rejects mapped Google accounts as well. Names and email are validated/bounded. No raw Google ID tokens are persisted.
- User + identity creation is transactional. Duplicate/deadlock races roll back, re-read the winning mapping and retry a bounded number of times. Failed mapping insertion leaves no orphan user. Session saving occurs after the account transaction commits: if session storage fails, login returns an error and a later retry can reuse the existing mapping.
- Both login methods share session regeneration, fresh CSRF/page tokens, an 8-hour absolute authentication limit and a MySQL session store. Session save must succeed before login success.
- `/api/me` requires the HttpOnly SameSite=Lax cookie plus X-Page-Token and checks the current user from MySQL. CSRF tokens protect POST requests. API responses are no-store.
- Per-tab page token is stored in sessionStorage to allow refresh restoration. Only this application token is stored there, never passwords or Google credentials. It is accessible to JavaScript, so XSS prevention remains important. Cookie alone cannot authorize /api/me.
- Logout destroys the server session, clears the cookie and per-tab token and disables Google's automatic account selection. It signs out of this app, not the user's Google account.

The latest specification restores Logout and refresh persistence, superseding the earlier page-close/refresh-login policy. sessionStorage normally disappears on tab close, but browser session/tab restoration can preserve it. This implementation does not promise that closing/reopening a restored browser tab forces login. Use explicit logout; the absolute session expiry remains 8 hours.

## Security / GitHub / deployment

Helmet sets CSP, anti-framing, MIME sniffing and other headers. CSP permits official Google GIS script/frame/style endpoints and the existing weather API requests. COOP permits the Google popup. HSTS/upgrade-insecure-requests are enabled for production, not localhost development.

Login/register/Google endpoints share a limit of 30 requests per IP per 15 minutes. The limiter uses process-local memory; a multi-instance deployment needs a shared limiter store. Set TRUST_PROXY=1 only behind exactly one trusted proxy with a controlled ingress. Set NODE_ENV=production and use HTTPS for Secure cookies. Preserve SESSION_SECRET across restarts and keep all credentials in host environment secrets.

Root/backend .gitignore exclude .env variants, node_modules and logs; .env.example is safe to publish. No Git repository exists in this checkout, so tracked files/history could not be audited. If secrets were previously published elsewhere, rotate them and clean that history. No commit, push, publication or deployment was performed.

GitHub Pages cannot run Express/MySQL. Host the Node server and database appropriately, serving UI and API from one origin. Before public deployment complete real-browser Google login/logout tests, HTTPS/proxy tests, monitoring/backups and account recovery/email verification requirements. Account linking is deliberately unsupported rather than linking by email automatically. Weather/static assets are public; private backend data must enforce session authorization.

## Verification

`npm.cmd test --prefix backend`: 8 passing tests. Includes password regression tests, Google routes using injected verification fixtures, real Google-library cryptographic verification using local RSA keys (only public-key retrieval is replaced), session save failure, expiry, cookie/token rotation, /api/me, logout replay, rate limits/security headers and a mocked-DOM frontend flow. Transaction rollback/race tests use an in-memory database model; real simultaneous MySQL signups were not tested.

Local MySQL checks confirmed connection, applied the additive identity migration and verified its unique indexes. Real MySQL session + HTTP smoke checks confirmed configured Google client availability, CSRF/cookie handling and malformed Google token rejection without changing user records. Source checks found no configured secret values in frontend/source files. Real Google-account browser sign-in and production deployment were not tested.

Detailed handoff: [GOOGLE_INTEGRATION_REPORT.md](GOOGLE_INTEGRATION_REPORT.md). Earlier SESSION_REPORT.md is historical.
