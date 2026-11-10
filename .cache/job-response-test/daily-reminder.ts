const base = "http://127.0.0.1:8803";
const password = "JobResponseTest!2026";
type Session = { cookie: string; csrf: string; id: number; username: string };
const passed: string[] = [];
const expect = (value: unknown, message: string) => { if (!value) throw Error(message); passed.push(message); };
async function login(username: string): Promise<Session> {
  const response = await fetch(`${base}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) });
  expect(response.status === 204, `${username} login`);
  const cookie = response.headers.get("set-cookie")?.split(";")[0]; if (!cookie) throw Error("Missing cookie");
  const session = await fetch(`${base}/api/session`, { headers: { cookie } }); const body = await session.json() as any;
  return { cookie, csrf: body.csrfToken, id: body.userId, username: body.username };
}
async function call(session: Session, path: string, method = "GET", body?: unknown) {
  const response = await fetch(`${base}${path}`, { method, headers: { cookie: session.cookie, "x-csrf-token": session.csrf, ...(body === undefined ? {} : { "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { response, body: await response.json().catch(() => null) };
}
const admin = await login("TestAdmin");
for (const [username, role] of [["Rep A", "REP"], ["Rep B", "REP"], ["Storekeeper", "STOREKEEPER"], ["Inactive Rep", "REP"], ["Deleted Rep", "REP"]] as const) expect((await call(admin, "/api/accounts", "POST", { username, password, role })).response.status === 201, `creates ${username}`);
const accountRows = (await call(admin, "/api/accounts")).body as Array<{ id: number; username: string }>;
const inactiveId = accountRows.find((account) => account.username === "Inactive Rep")!.id;
const deletedId = accountRows.find((account) => account.username === "Deleted Rep")!.id;
expect((await call(admin, `/api/accounts/${inactiveId}`, "PUT", { active: 0 })).response.ok, "deactivates reminder-ineligible Rep");
expect((await call(admin, `/api/accounts/${deletedId}`, "DELETE")).response.ok, "deletes reminder-ineligible Rep");
const repA = await login("Rep A"), repB = await login("Rep B"), store = await login("Storekeeper");
for (const session of [admin, repA, repB, store]) expect((await call(session, "/api/push/subscriptions", "POST", { endpoint: `https://push-test.example/reminder-${session.id}`, keys: { p256dh: "test-key", auth: "test-auth" } })).response.status === 201, `${session.username} registers mock device`);
const buyer = await call(admin, "/api/buyers", "POST", { full_name: "Reminder Buyer", phone: "0770000000", address: "Reminder Address" });
const product = await call(admin, "/api/products", "POST", { name: "Reminder Product", price_minor: 10000 });
expect(buyer.response.status === 201 && product.response.status === 201, "creates order prerequisites");
const createOrder = async (key: string) => { const result = await call(repA, "/api/quotations", "POST", { idempotencyKey: key, buyerId: buyer.body.id, quotationDate: "2026-11-10", items: [{ productId: product.body.id, quantity: 1, unitPriceMinor: 10000 }] }); expect(result.response.status === 201, `creates ${key}`); return result.body; };
const visible = await createOrder("11111111-aaaa-4111-8111-111111111111");
const hidden = await createOrder("22222222-bbbb-4222-8222-222222222222");
const cancelled = await createOrder("33333333-cccc-4333-8333-333333333333");
const dispatched = await createOrder("44444444-dddd-4444-8444-444444444444");
expect((await call(admin, `/api/quotations/${hidden.id}/visibility`, "PUT", { hidden: true })).response.ok, "hides one pending order");
expect((await call(admin, `/api/quotations/${cancelled.id}/cancel`, "POST", { reason: "Reminder test" })).response.ok, "cancels one order");
const dispatchDetail = await call(store, `/api/quotations/${dispatched.id}`);
expect((await call(store, `/api/quotations/${dispatched.id}/packing`, "PUT", { version: dispatchDetail.body.dispatch_version, items: dispatchDetail.body.items.map((item: any) => ({ productId: item.product_id, checked: true })) })).response.ok, "packs dispatch test order");
expect((await call(store, `/api/quotations/${dispatched.id}/dispatch`, "POST", {})).response.ok, "dispatches one order");
const trigger = await fetch(`${base}/cdn-cgi/local/explorer/api/local/scheduled?worker=rsk-job-response-isolated`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cron: "0 4 * * *" }) });
expect(trigger.ok, `daily cron trigger accepted (${trigger.status})`);
await new Promise((resolve) => setTimeout(resolve, 250));
const inbox = async (session: Session) => (await call(session, "/api/notifications?limit=100")).body.notifications.filter((notification: any) => notification.type.startsWith("DAILY_PENDING_DISPATCH"));
const adminReminders = await inbox(admin), repAReminders = await inbox(repA), repBReminders = await inbox(repB), storeReminders = await inbox(store);
expect(adminReminders.length === 1 && adminReminders[0].message.includes("2 orders are pending"), "Admin count includes hidden pending order");
expect(storeReminders.length === 1 && storeReminders[0].message.includes("1 order is pending"), "Storekeeper count excludes hidden/cancelled/dispatched");
expect(repAReminders.length === 1 && repAReminders[0].message.includes("1 of your order is pending"), "Rep count is owner-scoped and excludes hidden/cancelled/dispatched");
expect(repBReminders.length === 1 && repBReminders[0].message === "None of your orders are pending dispatch.", "Zero-count Rep receives correct reminder");
for (const [session, notification] of [[admin, adminReminders[0]], [repA, repAReminders[0]], [repB, repBReminders[0]], [store, storeReminders[0]]] as const) { const delivery = await call(session, `/api/notifications/${notification.id}/delivery`); expect(Boolean(delivery.body.delivered_at), `${session.username} reminder was mock-delivered`); }
const repeat = await fetch(`${base}/cdn-cgi/local/explorer/api/local/scheduled?worker=rsk-job-response-isolated`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cron: "0 4 * * *" }) });
expect(repeat.ok, "repeated daily cron trigger accepted"); await new Promise((resolve) => setTimeout(resolve, 150));
expect((await inbox(admin)).length === 1 && (await inbox(repA)).length === 1 && (await inbox(repB)).length === 1 && (await inbox(store)).length === 1, "Repeated daily trigger does not duplicate reminders");
expect(adminReminders[0].target_type === "order-pending", "Reminder navigation targets pending Orders");
console.log(JSON.stringify({ ok: true, passed, excludedUserIds: { inactiveId, deletedId } }, null, 2));
