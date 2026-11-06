import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const base = "http://127.0.0.1:8787";
const env = Object.fromEntries(readFileSync(".dev.vars", "utf8").split(/\r?\n/).filter((line) => line.includes("=")).map((line) => {
  const index = line.indexOf("=");
  return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
}));
const csrf = randomUUID();
const sessionVersion = Number(process.env.OWNER_SESSION_VERSION || "1");
const payload = Buffer.from(JSON.stringify({ userId: 1, username: env.OWNER_USERNAME, role: "ADMIN", sessionVersion, exp: Date.now() + 3_600_000, csrf })).toString("base64url");
const cookie = `rt_session=${payload}.${createHmac("sha256", env.SESSION_SECRET).update(payload).digest("base64url")}`;
const tag = `SIMPLE-PRODUCT-${Date.now()}`;
const assert = (value: unknown, label: string) => { if (!value) throw new Error(`FAIL ${label}`); console.log(`PASS ${label}`); };
async function request(path: string, method = "GET", body?: unknown) {
  const response = await fetch(`${base}${path}`, { method, headers: { cookie, ...(body ? { "content-type": "application/json" } : {}), ...(!["GET", "HEAD"].includes(method) ? { "X-CSRF-Token": csrf } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await response.text();
  return { response, data: text ? JSON.parse(text) : null };
}

const created = await request("/api/products", "POST", { name: `${tag} Original`, price_minor: 123456 });
assert(created.response.status === 201 && created.data.brand === `${tag} Original` && created.data.model_name === "" && /^AUTO-/.test(created.data.sku), "two-field product creation generates an internal SKU");
const found = await request(`/api/products?q=${encodeURIComponent(tag)}`);
assert(found.data.some((product: { id: number }) => product.id === created.data.id), "simple product search");
const updatedName = `${tag} Updated`;
const edited = await request(`/api/products/${created.data.id}`, "PUT", { name: updatedName, price_minor: 234567, active: 1 });
assert(edited.response.status === 200, "two-field product edit");
const buyer = await request("/api/buyers", "POST", { full_name: `${tag} Buyer`, phone: "DEV-SIMPLE-0812345678", email: "", address: "Simple product test address" });
const order = await request("/api/quotations", "POST", { idempotencyKey: randomUUID(), buyerId: buyer.data.id, quotationDate: "2026-11-06", items: [{ productId: created.data.id, quantity: 2 }] });
assert(order.response.status === 201 && order.data.total_minor === 469134 && order.data.items[0].item_name === updatedName, "order snapshot and PDF source use the simplified item name");
await request(`/api/products/${created.data.id}`, "PUT", { name: updatedName, price_minor: 234567, active: 0 });
await request(`/api/buyers/${buyer.data.id}`, "PUT", { full_name: buyer.data.full_name, phone: buyer.data.phone, email: "", address: "", active: 0 });
console.log("PASS labelled simple-product test records retained inactive");
