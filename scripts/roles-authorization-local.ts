import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const base = "http://127.0.0.1:8787";
const env = Object.fromEntries(readFileSync(".dev.vars", "utf8").split(/\r?\n/).filter((line) => line.includes("=")).map((line) => {
  const index = line.indexOf("=");
  return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
}));
const csrf = randomUUID();
const ownerSessionVersion = Number(process.env.OWNER_SESSION_VERSION || "1");
const payload = Buffer.from(JSON.stringify({ userId: 1, username: env.OWNER_USERNAME, role: "ADMIN", sessionVersion: ownerSessionVersion, exp: Date.now() + 3_600_000, csrf })).toString("base64url");
const adminCookie = `rt_session=${payload}.${createHmac("sha256", env.SESSION_SECRET).update(payload).digest("base64url")}`;
const tag = `ROLE-ACCEPTANCE-${Date.now()}`;
const assert = (condition: unknown, label: string) => { if (!condition) throw new Error(`FAIL ${label}`); console.log(`PASS ${label}`); };
async function request(path: string, method = "GET", body?: unknown, session = { cookie: adminCookie, csrf }) {
  const response = await fetch(`${base}${path}`, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), cookie: session.cookie, ...(!["GET", "HEAD"].includes(method) ? { "X-CSRF-Token": session.csrf } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await response.text();
  return { response, data: text ? JSON.parse(text) : null };
}
async function login(username: string, password: string) {
  const response = await fetch(`${base}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) });
  const cookie = response.headers.get("set-cookie")?.split(";")[0] || "";
  if (response.status !== 204) return { response, cookie, csrf: "" };
  const session = await fetch(`${base}/api/session`, { headers: { cookie } });
  return { response, cookie, csrf: (await session.json()).csrfToken as string };
}

assert((await request("/api/session")).response.status === 200, "legacy owner Admin session");
const repAPassword = "Rep α password ";
const repBPassword = "Rep β password ";
const repAName = `${tag}-A`;
const repBName = `${tag}-B`;
const repA = await request("/api/accounts", "POST", { username: repAName, password: repAPassword });
const repB = await request("/api/accounts", "POST", { username: repBName, password: repBPassword });
assert(repA.response.status === 201 && repB.response.status === 201, "Admin creates Rep accounts with Unicode/space passwords");
const aSession = await login(repAName, repAPassword);
const bSession = await login(repBName, repBPassword);
assert(aSession.response.status === 204 && bSession.response.status === 204, "Rep passwords authenticate exactly");

const product = await request("/api/products", "POST", { brand: tag, model_name: "Role Watch", sku: `${tag}-SKU`, colour: "Test", description: "Role authorization test", price_minor: 10000 });
assert(product.response.status === 201, "Admin creates product");
const forbiddenCreate = await request("/api/products", "POST", { brand: "REP", model_name: "Blocked", sku: `${tag}-BLOCKED`, price_minor: 100 }, aSession);
const forbiddenEdit = await request(`/api/products/${product.data.id}`, "PUT", { ...product.data, price_minor: 1, active: 1 }, aSession);
const forbiddenDelete = await request(`/api/products/${product.data.id}`, "DELETE", undefined, aSession);
assert(forbiddenCreate.response.status === 403 && forbiddenEdit.response.status === 403 && forbiddenDelete.response.status === 403, "Reps cannot mutate products");
const forbiddenAccountDelete = await request(`/api/accounts/${repB.data.id}`, "DELETE", undefined, aSession);
assert(forbiddenAccountDelete.response.status === 403, "Reps cannot delete accounts");

const buyer = await request("/api/buyers", "POST", { full_name: `${tag} Buyer`, phone: "DEV-ROLE-0812345678", email: "", address: "Role authorization test address" }, aSession);
assert(buyer.response.status === 201, "Rep creates buyer");
const orderPayload = (key: string) => ({ idempotencyKey: key, buyerId: buyer.data.id, quotationDate: "2026-11-05", items: [{ productId: product.data.id, quantity: 1 }] });
const orderA = await request("/api/quotations", "POST", orderPayload(randomUUID()), aSession);
const orderB = await request("/api/quotations", "POST", orderPayload(randomUUID()), bSession);
assert(orderA.response.status === 201 && orderB.response.status === 201, "each Rep saves own order");
const crossDetail = await request(`/api/quotations/${orderA.data.id}`, "GET", undefined, bSession);
const repBHistory = await request(`/api/quotations?q=${encodeURIComponent(tag)}`, "GET", undefined, bSession);
assert(crossDetail.response.status === 404 && !repBHistory.data.some((row: { id: number }) => row.id === orderA.data.id), "Rep A order is inaccessible to Rep B");
const adminDetailA = await request(`/api/quotations/${orderA.data.id}`);
const adminHistory = await request(`/api/quotations?q=${encodeURIComponent(tag)}`);
assert(adminDetailA.response.status === 200 && adminHistory.data.some((row: { creator_username: string }) => row.creator_username === repAName), "Admin accesses Rep orders and creator username");

const hidden = await request(`/api/products/${product.data.id}`, "PUT", { ...product.data, active: 0 });
const hiddenSubmit = await request("/api/quotations", "POST", orderPayload(randomUUID()), bSession);
assert(hidden.response.status === 200 && hiddenSubmit.response.status === 422, "hidden product cannot be submitted by a Rep");
const deactivateA = await request(`/api/accounts/${repA.data.id}`, "PUT", { active: 0 });
const disabledSession = await request("/api/session", "GET", undefined, aSession);
const disabledLogin = await login(repAName, repAPassword);
assert(deactivateA.response.status === 200 && disabledSession.response.status === 401 && disabledLogin.response.status === 401, "deactivated Rep loses current session and cannot log in");
await request(`/api/accounts/${repA.data.id}`, "PUT", { active: 1 });
assert((await login(repAName, repAPassword)).response.status === 204, "reactivated Rep requires a fresh login");

const resetB = await request(`/api/accounts/${repB.data.id}/reset-password`, "POST", { password: "new β password" });
const revokedB = await request("/api/session", "GET", undefined, bSession);
assert(resetB.response.status === 200 && revokedB.response.status === 401 && (await login(repBName, repBPassword)).response.status === 401 && (await login(repBName, "new β password")).response.status === 204, "password reset revokes sessions and old password");
const bNewSession = await login(repBName, `new ${String.fromCodePoint(0x03b2)} password`);
const deleteAdmin = await request("/api/accounts/1", "DELETE");
assert(deleteAdmin.response.status === 422, "Admin accounts cannot be deleted");
const deleteRep = await request(`/api/accounts/${repB.data.id}`, "DELETE");
const deletedSession = await request("/api/session", "GET", undefined, bNewSession);
const deletedLogin = await login(repBName, `new ${String.fromCodePoint(0x03b2)} password`);
const retainedOrder = await request(`/api/quotations/${orderB.data.id}`);
assert(deleteRep.response.status === 200 && deletedSession.response.status === 401 && deletedLogin.response.status === 401 && retainedOrder.data.creator_username === repBName, "Admin soft-deletes Rep and preserves order creator history");
await request(`/api/accounts/${repA.data.id}`, "PUT", { active: 0 });
await request(`/api/accounts/${repB.data.id}`, "PUT", { active: 0 });
console.log("PASS labelled Rep accounts retained inactive after authorization test");
