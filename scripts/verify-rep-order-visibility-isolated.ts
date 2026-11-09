const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8790";
const mode = process.env.VISIBILITY_MODE || "create";
const expectedOldId = Number(process.env.OLD_ORDER_ID || 0);
type Session = { cookie: string; csrf: string };
const expect = (condition: unknown, message: string): asserts condition => { if (!condition) throw Error(message); };
async function login(username: string, password: string): Promise<Session> {
  const response = await fetch(`${base}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) });
  expect(response.status === 204, `Login failed for ${username}`); const cookie = response.headers.get("set-cookie")?.split(";")[0]; expect(cookie, "No cookie");
  const session = await fetch(`${base}/api/session`, { headers: { cookie } }); return { cookie, csrf: (await session.json()).csrfToken };
}
async function call(session: Session, path: string, init: RequestInit = {}) { const response = await fetch(`${base}${path}`, { ...init, headers: { "content-type": "application/json", cookie: session.cookie, "X-CSRF-Token": session.csrf, ...init.headers } }); return { response, body: await response.json().catch(() => null) }; }
async function main() {
  const admin = await login("Admin", "Admin-jobs-test-2026!"); const repA = await login("rep-a", "Rep-a-jobs-test!"); const repB = await login("rep-b", "Rep-b-jobs-test!");
  if (mode === "check") { const list = await call(repA, "/api/quotations?status=all"); expect(list.response.ok, "Rep A order listing failed"); expect(!list.body.some((order: any) => order.id === expectedOldId), "Rep A still sees a dispatched order older than 30 days"); console.log(JSON.stringify({ ok: true, expiredOrderExcluded: expectedOldId })); return; }
  const productResult = await call(admin, "/api/products", { method: "POST", body: JSON.stringify({ name: "Visibility test product", price_minor: 10000 }) }); expect(productResult.response.status === 201, "Test product creation failed");
  const buyers = await call(admin, "/api/buyers"); const buyerId = buyers.body[0].id; const productId = productResult.body.id;
  const createOrder = (session: Session) => call(session, "/api/quotations", { method: "POST", body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), buyerId, quotationDate: "2026-11-08", notes: "isolated visibility test", items: [{ productId, quantity: 1, unitPriceMinor: 10000 }] }) });
  const visible = await createOrder(repA), old = await createOrder(repA), foreign = await createOrder(repB); expect(visible.response.status === 201 && old.response.status === 201 && foreign.response.status === 201, "Could not create isolated orders");
  const list = await call(repA, "/api/quotations?status=all"); expect(list.response.ok && list.body.some((order: any) => order.id === visible.body.id) && list.body.some((order: any) => order.id === old.body.id) && !list.body.some((order: any) => order.id === foreign.body.id), "Rep ownership filtering failed");
  console.log(JSON.stringify({ ok: true, oldOrderId: old.body.id, visibleOrderId: visible.body.id }));
}
main().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
