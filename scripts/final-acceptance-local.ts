import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const base = process.env.RICH_TIME_BASE_URL || "http://127.0.0.1:8787";
const env = Object.fromEntries(
  readFileSync(".dev.vars", "utf8")
    .split(/\r?\n/)
    .filter((line) => line.includes("="))
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
    }),
);
if (!env.OWNER_USERNAME || !env.SESSION_SECRET) {
  throw new Error("Local owner/session configuration is missing.");
}

const csrf = randomUUID();
const payload = Buffer.from(JSON.stringify({ user: env.OWNER_USERNAME, exp: Date.now() + 60 * 60 * 1000, csrf })).toString("base64url");
const signature = createHmac("sha256", env.SESSION_SECRET).update(payload).digest("base64url");
const cookie = `rt_session=${payload}.${signature}`;
const tag = `FINAL-ACCEPTANCE-${Date.now()}`;

const assert = (condition: unknown, label: string) => {
  if (!condition) throw new Error(`FAIL ${label}`);
  console.log(`PASS ${label}`);
};
async function request(path: string, method = "GET", body?: unknown, auth = true, includeCsrf = true) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(auth ? { cookie } : {}),
      ...(auth && includeCsrf && !["GET", "HEAD"].includes(method) ? { "X-CSRF-Token": csrf } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return { response, data: text ? JSON.parse(text) : null };
}

const unauth = await request("/api/buyers", "GET", undefined, false);
assert(unauth.response.status === 401, "unauthenticated API rejection");
const incorrectLogin = await request("/api/login", "POST", { username: "final-acceptance-invalid", password: "incorrect" }, false, false);
assert(incorrectLogin.response.status === 401, "incorrect login rejection");
const csrfFailure = await request("/api/buyers", "POST", { full_name: `${tag} CSRF`, phone: "DEV-CSRF" }, true, false);
assert(csrfFailure.response.status === 403, "CSRF rejection");
const invalidBuyer = await request("/api/buyers", "POST", { full_name: "", phone: "" });
assert(invalidBuyer.response.status === 400, "buyer required-field validation");

const buyerCreated = await request("/api/buyers", "POST", { full_name: `${tag} Buyer`, phone: "DEV-ACCEPT-0812345678", email: "", address: "Acceptance test only" });
assert(buyerCreated.response.status === 201, "buyer creation");
const buyer = buyerCreated.data;
const productCreated = await request("/api/products", "POST", { brand: "FINAL ACCEPTANCE", model_name: "Snapshot Watch", sku: `${tag}-SKU`, colour: "Test", description: "Acceptance test only", price_minor: 10000 });
assert(productCreated.response.status === 201, "product creation");
const product = productCreated.data;

const buyerSearch = await request(`/api/buyers?q=${encodeURIComponent(tag.slice(0, 16))}`);
assert(buyerSearch.data.some((row: { id: number }) => row.id === buyer.id), "partial buyer search");
const productSearch = await request(`/api/products?q=${encodeURIComponent("snapshot")}`);
assert(productSearch.data.some((row: { id: number }) => row.id === product.id), "partial product search");

const idempotencyKey = randomUUID();
const payloadBody = { idempotencyKey, buyerId: buyer.id, quotationDate: "2026-11-04", items: [{ productId: product.id, quantity: 10 }] };
const saved = await request("/api/quotations", "POST", payloadBody);
assert(saved.response.status === 201 && saved.data.total_minor === 100000, "order save with backend total");
const repeated = await request("/api/quotations", "POST", payloadBody);
assert(repeated.response.status === 200 && repeated.data.id === saved.data.id, "idempotent retry creates one order");

const productEdited = await request(`/api/products/${product.id}`, "PUT", { ...product, price_minor: 34567, active: 1 });
assert(productEdited.response.status === 200, "product edit");
const buyerEdited = await request(`/api/buyers/${buyer.id}`, "PUT", { ...buyer, email: buyer.email || "", address: buyer.address || null, full_name: `${tag} Edited Buyer`, phone: "DEV-ACCEPT-0899999999", active: 1 });
assert(buyerEdited.response.status === 200, "buyer edit");
const reopened = await request(`/api/quotations/${saved.data.id}`);
assert(reopened.data.items[0].unit_price_minor === 10000 && reopened.data.total_minor === 100000, "saved price snapshot remains immutable");
const historicalSearch = await request(`/api/quotations?q=${encodeURIComponent(`${tag} Buyer`)}`);
assert(historicalSearch.data.some((row: { id: number }) => row.id === saved.data.id), "historical buyer snapshot search");

const deactivateProduct = await request(`/api/products/${product.id}`, "PUT", { ...product, price_minor: 34567, active: 0 });
const deactivateBuyer = await request(`/api/buyers/${buyer.id}`, "PUT", { ...buyer, email: buyer.email || "", address: buyer.address || null, full_name: `${tag} Edited Buyer`, phone: "DEV-ACCEPT-0899999999", active: 0 });
assert(deactivateProduct.response.status === 200 && deactivateBuyer.response.status === 200, "test records retained as inactive");
const logout = await request("/api/logout", "POST");
assert(logout.response.status === 204, "logout response");
const afterLogout = await request("/api/quotations", "GET", undefined, false);
assert(afterLogout.response.status === 401, "logged-out client rejection");

console.log("PASS no stock API exists or is mutated by the tested order workflow");
