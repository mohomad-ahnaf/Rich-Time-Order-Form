# RSK Holdings — Testing and Cleanup Report

Date: 10 November 2026 (Asia/Colombo)  
Scope: local review only. No deployment, remote D1 access, VAPID-key changes, or main-business-data reset was performed.

## Baseline and environment

- No `AGENTS.md` is present.
- Frontend: React 18 + Vite 6 (`src/main.tsx`, `src/styles.css`).
- API: Hono Worker (`src/worker.ts`) using local Cloudflare D1 migrations `0001`–`0017`.
- PWA: `public/sw.js`, manifest, locally stored branding/icon assets. API routes are network-only in the service worker.
- Notifications: Worker outbox, scheduled recovery, encrypted Web Push library, and a test-only mock transport guarded by `PUSH_TEST_MODE === "1"`.
- Existing working tree changes were preserved. The cleanup changes are limited to the files listed below.
- No lint command is configured in `package.json`.

## Cleanup performed

Only demonstrably unused legacy files/dependencies were removed.

| Removed item | Evidence |
| --- | --- |
| `src/main.tsx.bak` | Old compressed Rich Time implementation; no import or configuration reference. |
| `src/pdf-worker.ts` | No import/reference in active source. The only PDF.js canvas viewer is commented out; active previews use HTML and exported PDFs use jsPDF. |
| `public/favicon.svg` | `index.html` references `favicon-48.png`; manifest/service-worker shell use PNG assets only. |
| `public/icon.svg` | No active reference. It was the obsolete watch icon, superseded by branded PNG icons. |
| `scripts/generate-pwa-icons.mjs` | Only referenced the obsolete `public/icon.svg`; it also required `sharp`, which is not a declared dependency. |
| `@hono/zod-validator` | No application import/reference. |
| `pdfjs-dist` | No active application import/reference after the draft PDF canvas viewer was replaced by the HTML preview. |

Preserved: migrations, local backup/CSV ignore rules, operational and isolated-test scripts, current PNG PWA assets, RSK source artwork, notification test guards, all business code, and all data.

`npm ls` still reports the removed packages as **extraneous in the existing local `node_modules` directory**. They are not in `package.json`/lockfile; a future clean `npm ci` will remove them. I did not manually delete `node_modules` content.

## Commands and results

| Command/check | Result | Evidence |
| --- | --- | --- |
| `npm.cmd run build` | PASS | TypeScript no-emit check and Vite production build completed. |
| `npm.cmd test` | PASS | 2 test files, 5 tests passed (`calculations`, `order-reference`). |
| PowerShell parse of `scripts/create-local-developer-admin.ps1` | PASS | Script parsed without errors. |
| `npm.cmd ls --depth=0` | PASS with maintenance note | Declared dependency graph resolves; obsolete packages are only local extraneous folders. |
| Configured lint | NOT CONFIGURED | No lint script exists. |

The build emits the pre-existing Vite chunk-size warning for the main bundle (~647 kB minified). This is a maintainability/performance risk, not a build failure; no broad code-splitting rewrite was made in this cleanup.

## HTTP integration attempt

An isolated Worker was started against `.cache/job-response-test/review-state`, never the main D1 state.

1. Initial HTTP requests correctly exposed a harness defect: the newly created isolated D1 state had no migrations, producing `D1_ERROR: no such table: users` during login.
2. All migrations `0001`–`0017` were then applied successfully to that disposable state.
3. The first failed launch left stale temporary Worker listeners on port 8790. Subsequent test requests stalled because the port was no longer cleanly owned by one Worker process. The environment denied process inspection/termination for the remaining listeners, so a trustworthy rerun was not possible in this session.

This means the following are **BLOCKED**, not passed or failed: authenticated API suite covering jobs, orders, prices/PDF settings, rep visibility, notifications/outbox, persistent-session revocation, Storekeeper flows, reminders, and dispatch targets.

The existing scripts are present for these areas, including:

- `verify-jobs-isolated.ts`
- `verify-order-prices-pdf-header-isolated.ts`
- `verify-rep-order-visibility-isolated.ts`
- `verify-notifications-isolated.ts`
- `verify-push-outbox-isolated.ts`
- `verify-job-deleted-rep-isolated.ts`

The job script also needs one maintenance update before a full rerun: it predates the current Rep job-acceptance gate and attempts visit updates before accepting the newly assigned job. That is a test-fixture mismatch, not evidence that the API gate is broken.

## Follow-up isolated-harness attempt

After the initial blocked run, a second, independent disposable harness was created at `.cache/maint-review-isolated` on port 8800:

- A dedicated Wrangler configuration used only dummy Admin/session/VAPID values and `PUSH_TEST_MODE="1"`.
- All migrations `0001`–`0017` were explicitly applied before starting the Worker.
- A direct local login returned HTTP 204, confirming the migrated isolated Worker could bootstrap and authenticate its dummy Admin.
- `verify-jobs-isolated.ts` was corrected to submit the required Rep **Accept** response before testing checklist persistence. This restores the fixture to the current job-response business rule.

The command runner then failed to execute the Node/TSX HTTP suite reliably against that Worker: no requests reached the Worker log, despite the direct HTTP login succeeding. The Worker host also spawned protected child listener processes after the parent was stopped; attempts to stop only the temporary port-8800 listeners were denied/restarted by the host. Port 8790 was never touched in this follow-up.

Accordingly, full HTTP-suite results remain **BLOCKED by local process orchestration**, not marked PASS. The disposable config/state contains only dummy data and does not affect the main D1 database.

## Runnable isolated verification command

Use this command from the project root in VS Code:

```powershell
npm run verify:http:isolated
```

It builds the client, creates a unique timestamp/GUID run directory under the system temporary directory, writes a dummy-only configuration with mock-only push mode, selects an available port in `8810–8899`, applies migrations before starting one Worker, waits up to 30 seconds for `/api/session`, and runs each HTTP suite with a 120-second timeout. Each suite prints PASS/FAIL separately; any failed/timed-out suite makes the command exit nonzero. The command tracks and waits for only its own Worker process tree in `finally`. Failed runs preserve their state and logs for inspection; successful runs are removed.

The original no-request behavior was traced to `Start-Process`: it split the workspace path at `Rich Time` and Node attempted to load `F:\Business\Rich`. The harness now quotes the TSX CLI and test-script paths explicitly. No main database or real `.dev.vars` values are used.

The generated Wrangler configuration now serializes absolute forward-slash paths for `main`, `assets.directory`, and `migrations_dir`. It validates that the project migration directory contains the expected SQL files before invoking Wrangler. A subsequent disposable run confirmed Wrangler discovered and applied migrations `0001` through `0017` under that run's unique `.cache/isolated-http-verification-runs/.../state` directory; no remote database flag was used.

The harness now treats process results strictly and requires a numeric zero exit code for PASS. Its disposable probes have been executed: exit 0 was PASS; exit 7 was correctly reported as FAIL with code 7; and a timed-out child was correctly reported as FAIL. Wrangler 4.156.2 has no supported Worker `--no-watch` option (its `--live-reload` flag affects browser refresh only). Generated state, logs and probes therefore live outside the watched project; the generated Wrangler config remains in a quiet per-run project cache because this Wrangler version cannot resolve the Worker entry from a different drive. The Worker is launched directly through `node.exe`, not `cmd.exe`, so its local D1 persistence argument is not rewritten.

The latest preserved Worker run reached readiness without a startup error. Its stderr contained only the normal local warning that scheduled Workers are not automatically triggered. Fixture usernames are now suffixed per suite and account-request failures log the sanitized HTTP status/body. The deleted-Rep, notification inbox/session, and order-price/PDF-header suites subsequently passed. The Jobs suite still failed because its address preview included buyers from an earlier isolated run; its assertion was corrected to require the exact buyer IDs it created. The mock-push suite still needs a clean rerun after adding bounded polling for the event-triggered outbox claim. No HTTP 409 is treated as success.

The prior Node heap error was produced by a suite child process while inherited `NODE_OPTIONS=--max-old-space-size=1024` was active; it was not an application stack trace. The harness does not now set that cap. Several non-listening Node processes left by earlier failed temporary harness runs were terminated; no listening main application process was stopped. A subsequent production-build attempt still stalled after module transformation, so the complete rerun remains BLOCKED pending resolution of those remaining local process/resource conditions. Failed-run state and logs remain preserved in the system temporary directory.

The harness accepts `SKIP_HARNESS_BUILD=1` for fixture-only verification and emits an explicit warning that no fresh production build was performed. It also accepts `HARNESS_SUITES` as a comma-separated list of exact suite names. A harness-only rerun confirmed Rep order visibility PASS (exit 0). Jobs still returned HTTP 409 during its first account fixture request, and mock push observed no mock transport calls (`{}`) after the product event; both are FAIL and require further isolation/delivery scheduling investigation. The three child-result probes still report: exit 0 PASS, exit 7 FAIL (code 7), timeout FAIL. No suite result is inferred from output text alone.

Latest preserved evidence identified the Jobs fixture defect: its generated username was `rep-a-ndchecklistauthorization`. The suffix helper retained the suite-name tail and discarded the per-run UUID, causing a repeat across runs. The harness now supplies a new UUID for each suite. For mock push, observed evidence is limited to a successful product update followed by an empty mock-call map; notification/outbox/claim stages were not observed. A direct query against the state used for migration returned no notification rows, proving the Worker is not using that same persistence state. The mock test now explicitly checks that the active Rep's notification row exists before asserting transport calls. Until the persistence mismatch is resolved, the first missing delivery stage is NOT CONFIRMED.

Manual isolated verification established a matching marker: expected `75ad5508bf454297bb5296de6114db97`; the retained marker log reports `markerVerified:true`, which is emitted only after strict equality with the Worker response. However, zero of six suites executed. The manual verifier captured its own `Write-Output` status text into the marker exit-code variable, causing an early return while the shell still reported exit 0. The verifier now writes status with `Write-Host`, retains numeric exit codes, prints a six-suite table, and prints `SUITES_EXECUTED`/`SUITES_FAILED`. No suite is marked PASS from the earlier manual run.

## Final isolated HTTP verification

User-run manual verification against the marker-matched disposable D1 database completed all six suites successfully:

- `SUITES_EXECUTED=6`
- `SUITES_FAILED=0`
- `VERIFY_EXIT=0`

This is recorded as an isolated HTTP PASS. It does not verify production deployment, real remote D1 data, or physical-device behavior.

## Maintenance mode extension (local)

- Local D1 backup created before migration: `.local-backups/maintenance-before-20261110-204757.sqlite`.
- Additive migration `0018_maintenance_mode.sql` applied locally: PASS (7 statements). It adds an explicit `maintenance_capable` user capability, persistent state, and audit table; it does not delete sessions or business data.
- Production build: PASS.
- Existing unit tests: PASS (2 files, 5 tests).
- Isolated authenticated HTTP coverage for the new maintenance endpoints and physical-browser transition behavior: NOT TESTED in this run. It remains required before production deployment.

### Maintenance verification attempt

- A fresh marker-guarded manual isolated run was prepared at `.cache/manual-isolated-http/e111e1680e0d4a0f83b9cf010b945b56` with dummy configuration, a disposable D1 state directory, and `PUSH_TEST_MODE=1`.
- The Worker did not reach readiness: its owned Wrangler/Node process exited with `FATAL ERROR: Zone Allocation failed - process out of memory` before the marker request or any maintenance suite request could run. Preserved stderr: `.cache/manual-isolated-http/e111e1680e0d4a0f83b9cf010b945b56/logs/maintenance-worker.stderr.log`.
- Therefore Developer/role authorization, maintenance `503` behavior, session recovery, restart persistence, scheduled pause/resume, audit records, and browser transition checks are **BLOCKED / NOT TESTED**, not PASS.
- Only the failed temporary Worker process was stopped. The main Worker, main D1, and main data were not touched.
- The same disposable D1 was subsequently reseeded with supported DML only. The prior `CREATE TEMP TABLE fixture_assertion` was the rejected `SQLITE_AUTH` statement; no fixture rows had been committed. The corrected seed exited `0` and the separate Wrangler JSON verification exited `0`, confirming exactly: `Developer` (active `ADMIN`, `maintenance_capable=1`) and `OtherAdmin` (active `ADMIN`, `maintenance_capable=0`). The HTTP maintenance suite has not yet been rerun.

## Test matrix

| Area | HTTP/unit | Browser | Physical device |
| --- | --- | --- | --- |
| Build and TypeScript frontend coverage | PASS | N/A | N/A |
| Calculation and order-reference unit coverage | PASS (5 tests) | N/A | N/A |
| Authentication/session/revocation | BLOCKED | NOT TESTED | NOT TESTED |
| Admin/Rep/Storekeeper/Developer authorization | BLOCKED | NOT TESTED | NOT TESTED |
| Buyers and snapshots | BLOCKED | NOT TESTED | NOT TESTED |
| Products and product-event identities | BLOCKED | NOT TESTED | NOT TESTED |
| Orders/PDF/price/idempotency | BLOCKED | NOT TESTED | NOT TESTED |
| Dispatch/packing/cancellation visibility | BLOCKED | NOT TESTED | NOT TESTED |
| Jobs/acceptance/checklists/concurrency | BLOCKED | NOT TESTED | NOT TESTED |
| Inbox/outbox/mock-push behavior | BLOCKED | NOT TESTED | NOT TESTED |
| Daily reminders/dispatch targets | BLOCKED | NOT TESTED | NOT TESTED |
| PWA manifest/service-worker source wiring | REVIEWED ONLY | NOT TESTED | NOT TESTED |
| Real provider delivery, iPhone/Android alerts/badges/sharing/install | NOT TESTED | NOT TESTED | NOT TESTED |

Mock-push acceptance must not be interpreted as a real phone-delivery result.

## Security and maintenance observations

- Test-only push inspection/reset routes remain unavailable unless the Worker environment explicitly has `PUSH_TEST_MODE="1"`; normal configuration does not set it.
- No test-mode switch is accepted from HTTP input.
- The current source uses service-worker cache versioning and leaves API requests network-only.
- `src/worker.ts` is excluded from the current `tsconfig.json` TypeScript program. Vite/production build therefore validates the client but does not provide a dedicated Worker type-check. Adding a separate Worker check is recommended, but was not done here because it needs a deliberate Workers/D1 type-check configuration rather than a low-risk cleanup edit.
- The application currently has limited automated coverage relative to its broad business surface. The isolated scripts are valuable, but should be consolidated into a repeatable command that creates state, applies migrations, starts exactly one temporary Worker, runs the suites, and reliably stops it.

## Preservation confirmation

- UI, navigation, layouts, API behavior, business rules, migration history, and PWA behavior were not redesigned or intentionally altered.
- Main local D1/business records, subscriptions, and secrets were not accessed or changed during this review.
- No deployment, Git push, remote-resource provisioning, or VAPID-key regeneration occurred.
