/** Run against a disposable Worker started with PUSH_TEST_MODE=1. */
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8793";
const adminUsername = process.env.TEST_ADMIN_USERNAME || "Admin";
const pw = process.env.TEST_ADMIN_PASSWORD || "Admin-push-test-2026!";
const assert = (v: unknown, m: string): asserts v => { if (!v) throw Error(m); };
type S = { cookie: string; csrf: string };
async function login(username: string, password: string): Promise<S> { const r = await fetch(`${base}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) }); assert(r.status === 204, `login ${username}`); const cookie = r.headers.get("set-cookie")!.split(";")[0]; const s = await fetch(`${base}/api/session`, { headers: { cookie } }); return { cookie, csrf: (await s.json()).csrfToken }; }
async function call(s: S, path: string, method = "GET", body?: unknown) { const r = await fetch(`${base}${path}`, { method, headers: { cookie: s.cookie, "X-CSRF-Token": s.csrf, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }); return { r, b: await r.json().catch(() => null) }; }
const endpoint = (kind: string, id: string) => `https://${kind}.example.test/${id}`;
async function main() {
  const admin = await login(adminUsername, pw); const tag = Date.now().toString(36);
  const rep = await call(admin, "/api/accounts", "POST", { username: `push-rep-${tag}`, password: "Push-rep-test!", role: "REP" }); assert(rep.r.status === 201, "create rep");
  const rs = await login(rep.b.username, "Push-rep-test!");
  const subscribe = async (kind: string) => { const r = await call(rs, "/api/push/subscriptions", "POST", { endpoint: endpoint(kind, tag), keys: { p256dh: "test-key", auth: "test-auth" } }); assert(r.r.status === 201, `subscribe ${kind}`); };
  await subscribe("push-test-ok"); await subscribe("push-test-expired"); await subscribe("push-test-transient-once"); await subscribe("push-test-transient");
  await call(admin, "/api/test/push-reset", "POST", {});
  const product = await call(admin, "/api/products", "POST", { name: `Push test ${tag}`, price_minor: 100 }); assert(product.r.status === 201, "create product");
  const update = await call(admin, `/api/products/${product.b.id}`, "PUT", { name: `Push test ${tag}`, price_minor: 101, active: 1 }); assert(update.r.ok, "enqueue product event");
  const inbox = await call(rs, "/api/notifications"); assert(inbox.r.ok && inbox.b.notifications.some((notification: any) => notification.type === "PRODUCT_PRICE_CHANGED"), `notification row missing for active Rep: ${JSON.stringify(inbox.b)}`);
  const until = Date.now() + 3000; let state: Awaited<ReturnType<typeof call>>;
  do { state = await call(admin, "/api/test/push-state"); if (state.b.calls[endpoint("push-test-ok", tag)] === 1) break; await new Promise((resolve) => setTimeout(resolve, 50)); } while (Date.now() < until);
  assert(state!.b.calls[endpoint("push-test-ok", tag)] === 1, `successful transport call: ${JSON.stringify(state!.b.calls)}`); assert(state!.b.calls[endpoint("push-test-expired", tag)] === 1, "expired transport call"); assert(state!.b.calls[endpoint("push-test-transient-once", tag)] === 1, "first transient call"); assert(state!.b.calls[endpoint("push-test-transient", tag)] === 1, "first permanent transient call");
  console.log(JSON.stringify({ ok: true, tag, endpoints: Object.keys(state.b.calls) }));
}
main().catch(error => { console.error(error.stack || error.message); process.exit(1); });
