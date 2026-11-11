# RSK Holdings production deployment runbook

This runbook prepares a Cloudflare Workers deployment with Workers Static Assets and a **new remote D1 database**. It is deliberately procedural: following it is an authorized deployment change and is not performed by this repository or this document.

## Current configuration assessment

- `wrangler.toml` configures one Worker entry point, `src/worker.ts`, and Static Assets from `dist` with `not_found_handling = "single-page-application"`.
- API routes are handled by Hono before the final `app.all("*")` asset fallback. `/api/*` therefore remains Worker-served while application routes receive the SPA shell.
- The configured cron expressions are `*/5 * * * *` (outbox retry/recovery) and `0 4 * * *` (09:30 Asia/Colombo daily reminder; Cloudflare cron uses UTC).
- The checked-in D1 ID is intentionally a placeholder: `REPLACE_WITH_D1_DATABASE_ID`. It must not be deployed as-is.
- Local state is `.wrangler/state`; manual-isolated state is below `.cache/manual-isolated-http`; neither is a production data source or remote binding.

## Required production configuration

Create one production D1 database and bind it as `DB`. Do not reuse local state, a manual-isolated database, or an existing unrelated D1 database.

Required Worker secret names (values are not documented here):

- `OWNER_USERNAME`
- `OWNER_PASSWORD_HASH`
- `SESSION_SECRET`
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`

Set these as Cloudflare Worker secrets, never as committed `vars`, checked-in files, frontend values, or shell history. `VAPID_SUBJECT` must be a monitored `mailto:` address or HTTPS contact URL accepted by push providers.

Non-secret bindings/configuration:

- `DB`: remote D1 binding.
- Static Assets directory: `dist`.
- `ASSETS`: Workers Static Assets binding.
- Worker name and production route/custom domain.
- Cron triggers shown above.

`PUSH_TEST_MODE` must be absent from production configuration. Test/mock endpoints return 404 unless that exact isolated-test variable equals `"1"`; do not define it in a production environment. Do not copy isolated Wrangler configs or dummy VAPID values.

## Ordered deployment procedure

1. Confirm a clean reviewed release, run `npm run build`, and record the source revision and build output.
2. Export and securely retain the intended local business-data source before any conversion/import work. Also retain an unmodified local backup.
3. Create a new remote D1 database and place its returned ID only in the production Worker configuration/binding.
4. Configure the production Worker name, Static Assets binding, HTTPS custom domain/route, and both cron triggers. Do not deploy yet.
5. Set all required secrets through Cloudflare's secret mechanism. Verify their names only; never print their values.
6. Apply migrations in lexicographic order, `0001_initial.sql` through `0018_maintenance_mode.sql`, to the empty remote D1. `0018_maintenance_mode.sql` is required before any release containing maintenance-mode code.
7. Import the reviewed business data using the data-transfer plan below.
8. Validate remote row counts, foreign-key relationships, order-code sequence, the intended active Developer account, and the maintenance state before traffic is routed.
9. Confirm `maintenance_state.id=1` has `enabled=0`. Confirm exactly the approved Developer user has `maintenance_capable=1`; do not grant that capability based only on username in client code.
10. Deploy the Worker and Static Assets as a versioned release. Attach the custom domain only after smoke testing the Worker hostname/preview.
11. Run production smoke tests. Do not import or enqueue synthetic notification data in the live business database unless an authorized test plan allows it.

## Data-transfer plan

Use one of these strategies, never both on the same target:

1. Apply all migrations to a new remote D1, then import **data only** with explicit IDs; or
2. Restore a complete, version-matched SQL backup into an empty D1 and verify its migration metadata before running no further duplicate migrations.

For the migrations-plus-data approach, preserve explicit IDs and parent/child order. Transfer reviewed business records in this order:

1. `settings` and the approved `users` records, preserving user IDs, password hashes, roles/`role_v2`, active/deleted state, session version, and `maintenance_capable` capability.
2. Active and historical `buyers` and `products`, preserving IDs.
3. Order-code sequence data, quotations/orders, then quotation item snapshots. Preserve order IDs, codes, creator IDs, buyer snapshots, product snapshots, custom unit prices, totals, and PDF-header snapshots.
4. Order dispatch/status audits, jobs, job items, job audits, job-response audits, and dispatch targets, preserving IDs and timestamps.
5. `maintenance_state` and `maintenance_audit`, ensuring production starts with maintenance disabled.
6. Any other audited business-history tables introduced by the applied migrations.

Do **not** transfer:

- Manual-isolated fixture accounts (`Developer`, `OtherAdmin`, `maintenance-rep`, `maintenance-store`) or any other test account.
- `user_sessions` rows or browser cookies.
- `push_subscriptions`; devices must subscribe again on the production HTTPS origin.
- `notification_outbox` rows, claims, locks, retry state, or stale pending push work.
- Test-only notification rows, test marker tables, mock-push state, cache state, or `.wrangler` persistence.

If inbox history is needed, transfer only reviewed user-owned `notifications` records after validating recipients and event identities; otherwise start the inbox clean. Do not import an outbox merely to recreate old phone alerts.

After importing explicit IDs, verify all counters/sequences used for new order codes continue above the highest imported value. New orders must never reuse historical codes.

## Domain, PWA, and push requirements

- Use a real HTTPS custom domain before phone/PWA testing. Secure session cookies, service workers, Push API, and Home Screen installation depend on a secure origin.
- Keep the current PWA manifest identity, scope, start URL, service-worker scope, and static assets on the same origin.
- Verify `/sw.js`, manifest, icons, and `/api/*` are served from the production Worker/domain. API responses must remain network-only/no-store; maintenance status must not be cached.
- Confirm the production VAPID public/private pair and subject are valid before subscribing a device. Existing local/tunnel subscriptions do not transfer.
- The five-minute cron is recovery/retry processing, not the sole delivery mechanism. Verify a newly queued production event attempts immediate delivery and that cron later handles recovery.

## Backup, recovery, and rollback

Before migration/import/deploy:

- Export the remote D1 source/target as applicable and retain encrypted, access-controlled copies.
- Record the Worker version, D1 database ID, migration list, import checksum/row counts, and secret-name checklist.
- Rehearse restoring into a separate recovery D1 before relying on a backup.

Rollback plan:

1. Put the app into Developer-controlled maintenance mode if the current release is unsafe and Developer access works.
2. Roll Worker traffic back to the previous known-good version/configuration.
3. Do not roll D1 backward by replaying destructive SQL. Restore to a separate D1 from the verified backup, validate it, then deliberately rebind/redeploy if database recovery is necessary.
4. Revalidate role access, immutable order snapshots, PDF generation, and push subscriptions after any database recovery.

If Developer loses access during maintenance, use the audited administrator recovery process described in `README.md`; there is intentionally no unauthenticated bypass URL.

## Production smoke-test checklist

Run using non-production test records only where authorized, then remove them through normal business controls if appropriate.

- Authentication: Admin, Rep, and Storekeeper sign in; persistent session restoration; logout; CSRF rejection.
- Authorization: each role sees only permitted navigation/API data; a non-Developer Admin cannot toggle maintenance.
- Maintenance: Developer enables it; another open session receives `MAINTENANCE_MODE`; Developer can still sign in and disable it; state survives a Worker restart.
- Core workflow: buyer/product search, draft/order save, idempotent retry, history, immutable snapshots, dispatch, jobs, and PDFs.
- PDF: preview/download/share with saved prices, customer snapshots, correct header, multiple pages, and filename/reference formatting.
- PWA: install on Android Chrome and iPhone Home Screen; session restore; app update; offline failure messaging; no cached authenticated API data.
- Push: enable a fresh production device subscription, trigger an authorized event from another account, receive a background notification, tap it, confirm authorization after navigation, and verify unread badge/inbox behavior.
- Scheduled work: invoke/observe both cron handlers, confirm 09:30 Asia/Colombo reminder timing, bounded retry recovery, and paused outbox/reminder processing during maintenance.
- Performance: measure cold launch, session restoration, login, order/product list requests, PDF generation, and push delivery on Wi-Fi and mobile data. Record p50/p95 API and Worker timings before launch.

## Missing configuration before production is possible

1. A real remote D1 database ID and production binding.
2. Production Worker name plus custom HTTPS domain/route.
3. All six production secrets listed above.
4. An approved, reviewed business-data export/import procedure and count reconciliation.
5. Confirmation that the approved Developer account/password hash/capability is included in the import.
6. Real-device production HTTPS/PWA/push acceptance testing.

No remote resource, deployment, import, secret, or DNS change is performed by this runbook.
