import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(readFileSync(".dev.vars", "utf8").split(/\r?\n/).filter((line) => line.includes("=")).map((line) => {
  const index = line.indexOf("=");
  return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
}));
const csrf = randomUUID();
const sessionVersion = Number(process.env.OWNER_SESSION_VERSION || "1");
const payload = Buffer.from(JSON.stringify({ userId: 1, username: env.OWNER_USERNAME, role: "ADMIN", sessionVersion, exp: Date.now() + 3_600_000, csrf })).toString("base64url");
const cookie = `rt_session=${payload}.${createHmac("sha256", env.SESSION_SECRET).update(payload).digest("base64url")}`;
const get = async (path: string) => {
  const response = await fetch(`http://127.0.0.1:8787${path}`, { headers: { cookie } });
  return { response, data: await response.json() as Array<{ brand: string; active: number }> };
};
const assert = (value: unknown, label: string) => { if (!value) throw new Error(`FAIL ${label}`); console.log(`PASS ${label}`); };

const all = await get("/api/products");
assert(all.response.status === 200 && all.data.length === 56 && all.data.every((product) => product.active === 1), "all 56 active products reach the product picker API without pagination");
const octki = await get(`/api/products?q=${encodeURIComponent("OCTKI SA.GL PAPER")}`);
assert(octki.data.length === 14, "partial OCTKI product search");
const exact = await get(`/api/products?q=${encodeURIComponent("P001G")}`);
assert(exact.data.length === 1 && exact.data[0].brand === "PVC ROLL P001G", "exact P001G product search");
