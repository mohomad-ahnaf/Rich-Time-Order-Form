const base = "http://127.0.0.1:8799";
const password = "StorekeeperTest!2026";

type Client = { cookie: string; csrf: string; username: string };
const results: string[] = [];
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
  results.push(`PASS ${message}`);
};
async function login(username: string): Promise<Client> {
  const response = await fetch(`${base}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) });
  assert(response.status === 204, `${username} login`);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error(`No session cookie for ${username}`);
  const session = await fetch(`${base}/api/session`, { headers: { cookie } });
  assert(session.status === 200, `${username} session`);
  const body = await session.json() as { csrfToken: string };
  return { cookie, csrf: body.csrfToken, username };
}
async function request(client: Client, path: string, method = "GET", body?: unknown) {
  return fetch(`${base}${path}`, {
    method,
    headers: { cookie: client.cookie, "x-csrf-token": client.csrf, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function json(client: Client, path: string, method = "GET", body?: unknown) {
  const response = await request(client, path, method, body);
  return { response, body: await response.json().catch(() => null) };
}

const admin = await login("Admin");
for (const [username, role] of [["Rep A", "REP"], ["Rep B", "REP"], ["Storekeeper", "STOREKEEPER"], ["Storekeeper Delete", "STOREKEEPER"]] as const) {
  const { response } = await json(admin, "/api/accounts", "POST", { username, password, role });
  assert(response.status === 201, `Admin creates ${role} ${username}`);
}
const repA = await login("Rep A");
const repB = await login("Rep B");
const storekeeper = await login("Storekeeper");
const storekeeperDelete = await login("Storekeeper Delete");

let result = await json(admin, "/api/buyers", "POST", { full_name: "Dispatch Test Buyer", phone: "0770000000", address: "Test Address" });
assert(result.response.status === 201, "Admin creates isolated buyer");
const buyer = result.body;
result = await json(admin, "/api/products", "POST", { name: "Dispatch Test Product", price_minor: 10000 });
assert(result.response.status === 201, "Admin creates isolated product");
const product = result.body;
async function createOrder(client: Client, key: string) {
  const order = await json(client, "/api/quotations", "POST", { idempotencyKey: key, buyerId: buyer.id, quotationDate: "2026-11-08", items: [{ productId: product.id, quantity: 2, unitPriceMinor: 10000 }] });
  assert(order.response.status === 201, `${client.username} creates order`);
  return order.body;
}
const orderA = await createOrder(repA, "11111111-1111-4111-8111-111111111111");
const orderB = await createOrder(repB, "22222222-2222-4222-8222-222222222222");

result = await json(storekeeper, "/api/quotations?dispatch=pending");
assert(result.response.status === 200 && result.body.orders.length === 2, "Storekeeper sees visible orders from both Reps");
assert(!JSON.stringify(result.body).match(/total_minor|unit_price_minor|row_total_minor|price_minor/), "Storekeeper list has no monetary fields");
result = await json(storekeeper, `/api/quotations/${orderA.id}`);
assert(result.response.status === 200 && !JSON.stringify(result.body).match(/total_minor|unit_price_minor|row_total_minor|price_minor/), "Storekeeper detail has no monetary fields");
for (const [path, method, body] of [["/api/quotations", "POST", { idempotencyKey: "33333333-3333-4333-8333-333333333333", buyerId: buyer.id, quotationDate: "2026-11-08", items: [{ productId: product.id, quantity: 1 }] }], ["/api/products", "GET", undefined], ["/api/buyers", "GET", undefined], ["/api/settings", "GET", undefined], [`/api/quotations/${orderA.id}/visibility`, "PUT", { hidden: true }], [`/api/quotations/${orderA.id}`, "DELETE", undefined]] as const) {
  const response = await request(storekeeper, path, method, body);
  assert(response.status === 403, `Storekeeper is blocked from ${method} ${path}`);
}
result = await json(repA, `/api/quotations/${orderB.id}`);
assert(result.response.status === 404, "Rep A cannot read Rep B order");
result = await json(admin, `/api/quotations/${orderB.id}/visibility`, "PUT", { hidden: true });
assert(result.response.status === 200, "Admin hides order");
assert((await request(storekeeper, `/api/quotations/${orderB.id}`)).status === 404, "Hidden order blocked for Storekeeper");
assert((await request(repB, `/api/quotations/${orderB.id}`)).status === 404, "Hidden order blocked for owner Rep");
await json(admin, `/api/quotations/${orderB.id}/visibility`, "PUT", { hidden: false });

result = await json(storekeeper, `/api/quotations/${orderA.id}`);
const original = result.body;
assert(original.items[0].packing_checked === 0, "Packing starts incomplete");
assert((await request(storekeeper, `/api/quotations/${orderA.id}/dispatch`, "POST", { notes: "not ready" })).status === 422, "Incomplete packing blocks dispatch");
result = await json(storekeeper, `/api/quotations/${orderA.id}/packing`, "PUT", { version: original.dispatch_version, items: original.items.map((item: any) => ({ productId: item.product_id, checked: true })) });
assert(result.response.status === 200 && result.body.items[0].packing_checked === 1, "Packing update persists");
const updated = result.body;
result = await json(storekeeper, `/api/quotations/${orderA.id}`);
assert(result.body.items[0].packing_checked === 1, "Packing persists after refetch");
const stale = await request(storekeeper, `/api/quotations/${orderA.id}/packing`, "PUT", { version: original.dispatch_version, items: original.items.map((item: any) => ({ productId: item.product_id, checked: false })) });
assert(stale.status === 409, "Stale packing update conflicts");
result = await json(storekeeper, `/api/quotations/${orderA.id}`);
assert(result.body.items[0].packing_checked === 1, "Stale packing update did not overwrite newer checklist");

const [dispatchOne, dispatchTwo] = await Promise.all([
  request(storekeeper, `/api/quotations/${orderA.id}/dispatch`, "POST", { notes: "packed", deliveryReference: "REF-1" }),
  request(storekeeper, `/api/quotations/${orderA.id}/dispatch`, "POST", { notes: "packed", deliveryReference: "REF-1" }),
]);
assert([200, 200].includes(dispatchOne.status) && [200, 200].includes(dispatchTwo.status), "Repeated dispatch requests are idempotent");
result = await json(storekeeper, `/api/quotations/${orderA.id}`);
assert(Boolean(result.body.dispatched_at) && result.body.dispatcher_username === "Storekeeper", "Dispatch records server timestamp and dispatcher");
assert((await request(repA, `/api/quotations/${orderA.id}/return-to-pending`, "POST", { reason: "no" })).status === 403, "Rep cannot return dispatch to pending");
assert((await request(storekeeper, `/api/quotations/${orderA.id}/return-to-pending`, "POST", { reason: "no" })).status === 403, "Storekeeper cannot return dispatch to pending");
assert((await request(admin, `/api/quotations/${orderA.id}/return-to-pending`, "POST", {})).status === 400, "Admin return requires reason");
result = await json(admin, `/api/quotations/${orderA.id}/return-to-pending`, "POST", { reason: "Test correction" });
assert(result.response.status === 200 && !result.body.dispatched_at, "Admin returns order to pending");

result = await json(admin, "/api/accounts");
const accounts = result.body as any[];
const storeRecord = accounts.find((account) => account.username === "Storekeeper");
const deleteRecord = accounts.find((account) => account.username === "Storekeeper Delete");
assert((await request(admin, `/api/accounts/${storeRecord.id}`, "PUT", { active: 0 })).status === 200, "Admin deactivates Storekeeper");
assert((await request(storekeeper, "/api/session")).status === 401, "Deactivation revokes Storekeeper session");
assert((await request(admin, `/api/accounts/${deleteRecord.id}`, "DELETE")).status === 200, "Admin deletes Storekeeper");
assert((await request(storekeeperDelete, "/api/session")).status === 401, "Deletion revokes Storekeeper session");

console.log(results.join("\n"));
