# Rich Time quotation system

Mobile-first quotation application for a single watch-shop owner. It runs a React/Vite interface and a Hono API on one Cloudflare Worker, with Cloudflare D1 as the persistent database. Quotations store buyer, product, price, and shop-detail snapshots; saving or sharing a quotation never changes stock.

## Structure

- `src/main.tsx` — mobile interface and on-demand PDF generation
- `src/worker.ts` — protected Hono API and static-asset Worker
- `migrations/` — versioned D1 schema
- `scripts/` — password helper and optional local-only seed SQL

## Local setup

1. Install Node 22+ and run `npm install`.
2. Copy `.dev.vars.example` to `.dev.vars`.
3. Run `npm run setup:credentials` and enter the owner username and password at its hidden local prompt. It writes the password hash and a random session secret to `.dev.vars` without displaying secrets. The lower-level `npm run password:hash -- "choose a strong password"` helper remains available when needed.
4. Run `npm run db:migrate:local` to create persistent local D1 data.
5. Optional development data: `npx wrangler d1 execute rich-time-db --local --persist-to .wrangler/state --file scripts/seed.sql`.
6. Run `npm run dev`, then open `http://127.0.0.1:5173` on the computer or the computer’s LAN address on a phone. The API Worker stays local on port 8787 and is reached only through Vite’s same-origin `/api` proxy.

For a trusted-phone HTTPS test, create `.certs/rich-time-key.pem` and `.certs/rich-time-cert.pem` with a local certificate authority such as `mkcert`, set `LAN_HTTPS=1` in the terminal, then run `npm run dev`. The phone must trust that local CA. The Worker still stays on loopback; Vite proxies `/api` over the local computer.

The password format uses PBKDF2-SHA-256 with 210,000 iterations, verified through Workers Web Crypto. Sessions are signed, expire after 12 hours, and use HttpOnly SameSite=Strict cookies (Secure on HTTPS). All state-changing API requests require the per-session CSRF token. Login attempts are throttled in the Worker instance; for strict global distributed throttling, add a Cloudflare rate-limit layer before production.

## API

All business endpoints require the session cookie. `GET /api/session`, buyer/product search and management, settings, quotation creation/list/detail are exposed under `/api`. `POST /api/quotations` requires a UUID idempotency key, validates active database entities, calculates prices and totals on the server, and saves quotation plus items in a D1 batch. Historical quotations are read-only.

## Deployment

1. Create a D1 database: `npx wrangler d1 create rich-time-db`.
2. Copy its returned ID into `wrangler.toml` (do not invent one).
3. Apply production schema: `npm run db:migrate:remote`.
4. Set secrets: `npx wrangler secret put OWNER_USERNAME`, `OWNER_PASSWORD_HASH`, and `SESSION_SECRET`.
5. Build with `npm run build`, then deploy with `npx wrangler deploy`.

Cloudflare’s free plan has request, Worker CPU, D1 storage/query, and deployment limits that can change; check the current Cloudflare dashboard limits before relying on it. The assigned `workers.dev` address is suitable for initial use, but free availability and quotas are not guaranteed permanently.

## Backup and restore

Export a remote backup with `npx wrangler d1 export rich-time-db --remote --output backup.sql`. Keep the export securely. To restore to a newly created database, inspect the SQL first and run `npx wrangler d1 execute NEW_DATABASE_NAME --remote --file backup.sql`; then bind the new database ID and deploy. Test restoration against a local or staging database before replacing production.

## PDF sharing

PDFs are generated in the browser from saved data, with repeated item headers and page numbers. On supported mobile browsers, Share opens the native sharing menu so the owner can choose WhatsApp or another app. When file sharing is not supported, the app downloads the PDF for manual attachment. Database operations require internet access; no offline mode is advertised.
