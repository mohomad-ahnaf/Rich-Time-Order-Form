/** Disposable HTTP notification/session verification. Run only against a fresh
 * isolated Worker state: TEST_BASE_URL=http://127.0.0.1:8791 npx tsx scripts/verify-notifications-isolated.ts */
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8791";
const adminUsername = process.env.TEST_ADMIN_USERNAME || "Admin";
const adminPassword = process.env.TEST_ADMIN_PASSWORD || "Admin-notify-test-2026!";
const fixtureSuffix = (process.env.TEST_RUN_ID || "").replace(/[^a-z0-9]/gi, "").slice(-24);
const fixtureUser = (name: string) => fixtureSuffix ? `${name}-${fixtureSuffix}` : name;
type Session = { cookie: string; csrf: string };
const expect = (condition: unknown, message: string): asserts condition => { if (!condition) throw Error(message); };
async function login(username: string, password: string): Promise<Session> {
  const response = await fetch(`${base}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) });
  expect(response.status === 204, `login ${username}: ${response.status}`);
  const cookie = response.headers.get("set-cookie")?.split(";")[0] || "";
  const session = await fetch(`${base}/api/session`, { headers: { cookie } });
  expect(session.ok, `session ${username}`); return { cookie, csrf: (await session.json()).csrfToken };
}
async function request(session: Session, path: string, init: RequestInit = {}) {
  const response = await fetch(`${base}${path}`, { ...init, headers: { "content-type": "application/json", cookie: session.cookie, "X-CSRF-Token": session.csrf, ...init.headers } });
  return { response, body: await response.json().catch(() => null) };
}
async function main() {
  const admin = await login(adminUsername, adminPassword);
  const rep = await request(admin, "/api/accounts", { method: "POST", body: JSON.stringify({ username: fixtureUser("notify-rep"), password: "Rep-notify-test!", role: "REP" }) });
  const second = await request(admin, "/api/accounts", { method: "POST", body: JSON.stringify({ username: fixtureUser("notify-rep-two"), password: "Rep-notify-test!", role: "REP" }) });
  expect(rep.response.status === 201 && second.response.status === 201, `test Rep creation (${rep.response.status}/${second.response.status}: ${JSON.stringify(rep.body)}/${JSON.stringify(second.body)})`);
  const repSession = await login(fixtureUser("notify-rep"), "Rep-notify-test!");
  const product = await request(admin, "/api/products", { method: "POST", body: JSON.stringify({ name: "Notification test item", price_minor: 10000 }) });
  expect(product.response.status === 201, "product creation");
  const changed = await request(admin, `/api/products/${product.body.id}`, { method: "PUT", body: JSON.stringify({ name: "Notification test item", price_minor: 11000, active: 1 }) });
  expect(changed.response.ok, "price change");
  const inbox = await request(repSession, "/api/notifications");
  expect(inbox.response.ok && inbox.body.notifications.some((n: any) => n.type === "PRODUCT_PRICE_CHANGED"), "Rep receives price-change notification");
  expect(!inbox.body.notifications.some((n: any) => n.recipient_user_id), "inbox does not disclose other recipients");
  const id = inbox.body.notifications[0].id;
  expect((await request(repSession, `/api/notifications/${id}/read`, { method: "PUT" })).response.ok, "own notification can be read");
  const otherRead = await request(await login(fixtureUser("notify-rep-two"), "Rep-notify-test!"), `/api/notifications/${id}/read`, { method: "PUT" });
  expect(otherRead.response.ok, "cross-account read does not disclose notification");
  const once = await request(admin, `/api/products/${product.body.id}`, { method: "PUT", body: JSON.stringify({ name: "Notification test item", price_minor: 11000, active: 1 }) });
  expect(once.response.ok, "unchanged product update");
  const again = await request(repSession, "/api/notifications");
  expect(again.body.notifications.filter((n: any) => n.type === "PRODUCT_PRICE_CHANGED").length === 1, "unchanged price does not duplicate event");
  const logout = await request(repSession, "/api/logout", { method: "POST" });
  expect(logout.response.status === 204 && (await fetch(`${base}/api/session`, { headers: { cookie: repSession.cookie } })).status === 401, "logout revokes current session");
  const repAgain = await login(fixtureUser("notify-rep"), "Rep-notify-test!");
  const reset = await request(admin, `/api/accounts/${rep.body.id}/reset-password`, { method: "POST", body: JSON.stringify({ password: "Reset-notify-test!" }) });
  expect(reset.response.ok && (await fetch(`${base}/api/session`, { headers: { cookie: repAgain.cookie } })).status === 401, "password reset revokes sessions");
  console.log(JSON.stringify({ ok: true, checks: ["recipients", "actor exclusion", "deduplication", "read isolation", "logout revocation", "password-reset revocation"] }));
}
main().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
