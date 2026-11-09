/**
 * Disposable HTTP integration verification for Rep jobs.
 * Start a Worker against an isolated --persist-to directory, bootstrap a test
 * Admin in that D1 database, then run:
 *   TEST_BASE_URL=http://127.0.0.1:8790 npx tsx scripts/verify-jobs-isolated.ts
 */
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8790";
const adminPassword = "Admin-jobs-test-2026!";
type Session = { cookie: string; csrf: string };
const expect = (condition: unknown, message: string): asserts condition => { if (!condition) throw Error(message); };
async function login(username: string, password: string): Promise<Session> {
  const response = await fetch(`${base}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) });
  expect(response.status === 204, `Login failed for ${username}: ${response.status}`);
  const cookie = response.headers.get("set-cookie")?.split(";")[0]; expect(cookie, `No session cookie for ${username}`);
  const session = await fetch(`${base}/api/session`, { headers: { cookie } }); expect(session.ok, `Session lookup failed for ${username}`);
  return { cookie, csrf: (await session.json()).csrfToken };
}
async function request(session: Session, path: string, init: RequestInit = {}) {
  const response = await fetch(`${base}${path}`, { ...init, headers: { "content-type": "application/json", cookie: session.cookie, "X-CSRF-Token": session.csrf, ...init.headers } });
  const body = await response.json().catch(() => null);
  return { response, body };
}
async function post(session: Session, path: string, body: unknown, expected = 200) {
  const result = await request(session, path, { method: "POST", body: JSON.stringify(body) });
  expect(result.response.status === expected, `${path}: expected ${expected}, got ${result.response.status}: ${JSON.stringify(result.body)}`); return result.body;
}
async function main() {
  const admin = await login("Admin", adminPassword);
  const repA = await post(admin, "/api/accounts", { username: "rep-a", password: "Rep-a-jobs-test!", role: "REP" }, 201);
  const repB = await post(admin, "/api/accounts", { username: "rep-b", password: "Rep-b-jobs-test!", role: "REP" }, 201);
  const storekeeper = await post(admin, "/api/accounts", { username: "store-jobs", password: "Store-jobs-test!", role: "STOREKEEPER" }, 201);
  const inactive = await post(admin, "/api/accounts", { username: "rep-inactive", password: "Inactive-jobs-test!", role: "REP" }, 201);
  expect((await request(admin, `/api/accounts/${inactive.id}`, { method: "PUT", body: JSON.stringify({ active: 0 }) })).response.ok, "Could not deactivate test Rep");
  const kandyA = await post(admin, "/api/buyers", { full_name: "Kandy Shop A", phone: "test-001", email: "", address: "12 Main Road, Kandy" }, 201);
  const kandyB = await post(admin, "/api/buyers", { full_name: "Kandy Shop B", phone: "test-002", email: "", address: "Hill Street, KANDY" }, 201);
  const galle = await post(admin, "/api/buyers", { full_name: "Galle Shop", phone: "test-003", email: "", address: "Fort Road, Galle" }, 201);
  const preview = await request(admin, "/api/jobs/buyer-preview?q=kAnDy");
  expect(preview.response.ok && preview.body.length === 2 && preview.body.every((buyer: any) => /kandy/i.test(buyer.address)), "Case-insensitive address preview did not return only Kandy buyers");
  const inactiveResult = await request(admin, "/api/jobs", { method: "POST", body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), repId: inactive.id, title: "Invalid", locationQuery: "Kandy", buyerIds: [kandyA.id] }) });
  expect(inactiveResult.response.status === 422, "Inactive Rep was accepted for assignment");
  const key = crypto.randomUUID();
  const payload = { idempotencyKey: key, repId: repA.id, title: "Kandy visits", locationQuery: "kandy", instructions: "Ask for the manager", dueDate: "2026-12-01", buyerIds: [kandyA.id, kandyB.id] };
  const job = await post(admin, "/api/jobs", payload, 201);
  const retry = await post(admin, "/api/jobs", payload);
  expect(job.id === retry.id && retry.items.length === 2 && !retry.items.some((item: any) => item.buyer_id === galle.id), "Assignment retry was not idempotent or included an unselected buyer");
  const repASession = await login("rep-a", "Rep-a-jobs-test!");
  const repBSession = await login("rep-b", "Rep-b-jobs-test!");
  const storeSession = await login("store-jobs", "Store-jobs-test!");
  const jobB = await post(admin, "/api/jobs", { idempotencyKey: crypto.randomUUID(), repId: repB.id, title: "Galle visit", locationQuery: "Galle", buyerIds: [galle.id] }, 201);
  const repAJobs = await request(repASession, "/api/jobs"); expect(repAJobs.response.ok && repAJobs.body.length === 1 && repAJobs.body[0].id === job.id, "Rep A job list leaked another Rep's job");
  expect((await request(repASession, `/api/jobs/${jobB.id}`)).response.status === 404, "Rep A opened Rep B job");
  expect((await request(repASession, `/api/jobs/${jobB.id}/items/${jobB.items[0].id}`, { method: "PUT", body: JSON.stringify({ visited: true, version: 0 }) })).response.status === 404, "Rep A updated Rep B item");
  expect((await request(repASession, "/api/jobs", { method: "POST", body: JSON.stringify(payload) })).response.status === 403, "Rep created a job");
  expect((await request(storeSession, "/api/jobs")).response.status === 403, "Storekeeper listed jobs");
  expect((await request(storeSession, `/api/jobs/${job.id}`)).response.status === 404, "Storekeeper opened a job");
  const before = await request(repASession, `/api/jobs/${job.id}`); const first = before.body.items[0], second = before.body.items[1];
  const firstVisit = await request(repASession, `/api/jobs/${job.id}/items/${first.id}`, { method: "PUT", body: JSON.stringify({ visited: true, version: first.version }) });
  expect(firstVisit.response.ok && firstVisit.body.items.find((item: any) => item.id === first.id).visited_at, "Visit was not persisted with a server timestamp");
  const stale = await request(repASession, `/api/jobs/${job.id}/items/${first.id}`, { method: "PUT", body: JSON.stringify({ visited: false, version: first.version }) }); expect(stale.response.status === 409, "Stale update did not return 409");
  const current = await request(repASession, `/api/jobs/${job.id}`); const freshFirst = current.body.items.find((item: any) => item.id === first.id), freshSecond = current.body.items.find((item: any) => item.id === second.id);
  const concurrent = await Promise.all([request(repASession, `/api/jobs/${job.id}/items/${freshFirst.id}`, { method: "PUT", body: JSON.stringify({ visited: false, version: freshFirst.version }) }), request(repASession, `/api/jobs/${job.id}/items/${freshSecond.id}`, { method: "PUT", body: JSON.stringify({ visited: true, version: freshSecond.version }) })]);
  expect(concurrent.every((item) => item.response.ok), "Concurrent updates to different items failed");
  const afterConcurrent = await request(repASession, `/api/jobs/${job.id}`); expect(afterConcurrent.body.status === "ACTIVE" && afterConcurrent.body.progress.visited === 1, "Concurrent updates left an incorrect job status");
  const lastFirst = afterConcurrent.body.items.find((item: any) => item.id === first.id);
  const completed = await request(repASession, `/api/jobs/${job.id}/items/${lastFirst.id}`, { method: "PUT", body: JSON.stringify({ visited: true, version: lastFirst.version }) }); expect(completed.response.ok && completed.body.status === "COMPLETED", "All visits did not complete the job");
  const completedFirst = completed.body.items.find((item: any) => item.id === first.id);
  const reopened = await request(repASession, `/api/jobs/${job.id}/items/${completedFirst.id}`, { method: "PUT", body: JSON.stringify({ visited: false, version: completedFirst.version }) }); expect(reopened.response.ok && reopened.body.status === "ACTIVE", "Unvisit did not reopen job");
  const originalSnapshot = reopened.body.items.find((item: any) => item.id === first.id).buyer_address;
  expect((await request(admin, `/api/buyers/${kandyA.id}`, { method: "PUT", body: JSON.stringify({ full_name: kandyA.full_name, phone: kandyA.phone, email: "", address: "Changed address, Colombo", active: 1 }) })).response.ok, "Buyer edit failed");
  const snapshotted = await request(repASession, `/api/jobs/${job.id}`); expect(snapshotted.body.items.find((item: any) => item.id === first.id).buyer_address === originalSnapshot, "Buyer edit altered job snapshot");
  const cancelled = await post(admin, `/api/jobs/${job.id}/cancel`, { reason: "Integration-test cancellation" }); expect(cancelled.status === "CANCELLED", "Admin cancellation failed");
  const afterCancel = await request(repASession, `/api/jobs/${job.id}/items/${first.id}`, { method: "PUT", body: JSON.stringify({ visited: true, version: snapshotted.body.items.find((item: any) => item.id === first.id).version }) }); expect(afterCancel.response.status === 422, "Cancelled job accepted a visit update");
  console.log(JSON.stringify({ ok: true, jobId: job.id, auditExpectedAtLeast: 8 }));
}
main().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
