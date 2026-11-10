const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8790";
const fixtureSuffix = (process.env.TEST_RUN_ID || "").replace(/[^a-z0-9]/gi, "").slice(-24);
const repUsername = fixtureSuffix ? `rep-deleted-${fixtureSuffix}` : "rep-deleted";
const fail = (message: string): never => { throw Error(message); };
async function main() {
  const login = await fetch(`${base}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: process.env.TEST_ADMIN_USERNAME || "Admin", password: process.env.TEST_ADMIN_PASSWORD || "Admin-jobs-test-2026!" }) });
  if (login.status !== 204) fail("Admin login failed"); const cookie = login.headers.get("set-cookie")!.split(";")[0]; const session = await fetch(`${base}/api/session`, { headers: { cookie } }); const csrf = (await session.json()).csrfToken;
  const call = async (path: string, init: RequestInit = {}) => { const response = await fetch(`${base}${path}`, { ...init, headers: { "content-type": "application/json", cookie, "X-CSRF-Token": csrf, ...init.headers } }); return { response, body: await response.json().catch(() => null) }; };
  const rep = await call("/api/accounts", { method: "POST", body: JSON.stringify({ username: repUsername, password: "Deleted-jobs-test!", role: "REP" }) }); if (rep.response.status !== 201) fail(`Could not create disposable Rep (${rep.response.status}: ${JSON.stringify(rep.body)})`);
  if (!(await call(`/api/accounts/${rep.body.id}`, { method: "DELETE" })).response.ok) fail("Could not delete disposable Rep");
  const buyer = await call("/api/buyers", { method: "POST", body: JSON.stringify({ full_name: `Deleted Rep Buyer ${fixtureSuffix}`, phone: "", email: "", address: "Kandy" }) }); if (buyer.response.status !== 201) fail(`Could not create disposable buyer (${buyer.response.status}: ${JSON.stringify(buyer.body)})`); const assignment = await call("/api/jobs", { method: "POST", body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), repId: rep.body.id, title: "Invalid deleted rep", locationQuery: "Kandy", buyerIds: [buyer.body.id] }) });
  if (assignment.response.status !== 422) fail(`Deleted Rep was accepted: ${assignment.response.status}`); console.log(JSON.stringify({ ok: true, deletedRepRejected: true }));
}
main().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
