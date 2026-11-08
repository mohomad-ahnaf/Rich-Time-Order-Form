const base = "http://127.0.0.1:8799";
const password = "StorekeeperTest!2026";
type Client = { cookie: string; csrf: string };
const assert = (value: unknown, text: string) => { if (!value) throw new Error(text); console.log(`PASS ${text}`); };
async function login(username: string, value = password): Promise<Client> {
  const response = await fetch(`${base}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password: value }) });
  assert(response.status === 204, `${username} login`);
  const cookie = response.headers.get("set-cookie")!.split(";")[0];
  const session = await fetch(`${base}/api/session`, { headers: { cookie } });
  return { cookie, csrf: (await session.json()).csrfToken };
}
const call = (client: Client, path: string, method = "GET", body?: unknown) => fetch(`${base}${path}`, { method, headers: { cookie: client.cookie, "x-csrf-token": client.csrf, ...(body === undefined ? {} : { "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });
const admin = await login("Admin");
let response = await call(admin, "/api/accounts", "POST", { username: "Storekeeper Reset", password, role: "STOREKEEPER" });
assert(response.status === 201, "Admin creates Storekeeper for password-reset test");
const resetStorekeeper = await login("Storekeeper Reset");
const accounts = await (await call(admin, "/api/accounts")).json();
const account = accounts.find((row: any) => row.username === "Storekeeper Reset");
response = await call(admin, `/api/accounts/${account.id}/reset-password`, "POST", { password: "ResetPassword!2026" });
assert(response.status === 200, "Admin resets Storekeeper password");
assert((await call(resetStorekeeper, "/api/session")).status === 401, "Password reset revokes Storekeeper session");
const repB = await login("Rep B");
const orders = await (await call(repB, "/api/quotations")).json();
const order = orders[0];
response = await call(admin, `/api/quotations/${order.id}`, "DELETE");
assert(response.status === 204, "Admin deletes isolated order");
assert((await call(repB, `/api/quotations/${order.id}`)).status === 404, "Deleted order blocked for owner Rep");
const resetStorekeeperNew = await login("Storekeeper Reset", "ResetPassword!2026");
assert((await call(resetStorekeeperNew, `/api/quotations/${order.id}`)).status === 404, "Deleted order blocked for Storekeeper");
