import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const base = "http://127.0.0.1:8790";
const env = Object.fromEntries(readFileSync(".dev.vars", "utf8").split(/\r?\n/).filter((line) => line.includes("=")).map((line) => {
  const index = line.indexOf("=");
  return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
}));
const csrf = randomUUID();
const payload = Buffer.from(JSON.stringify({ userId: 1, username: env.OWNER_USERNAME, role: "ADMIN", sessionVersion: 1, exp: Date.now() + 3_600_000, csrf })).toString("base64url");
const cookie = `rt_session=${payload}.${createHmac("sha256", env.SESSION_SECRET).update(payload).digest("base64url")}`;
const assert = (value: unknown, label: string) => { if (!value) throw new Error(`FAIL ${label}`); console.log(`PASS ${label}`); };
async function createBuyer(address?: string) {
  const response = await fetch(`${base}/api/buyers`, { method: "POST", headers: { "content-type": "application/json", cookie, "X-CSRF-Token": csrf }, body: JSON.stringify({ full_name: "ISOLATED ADDRESS TEST", phone: "DEV-ISOLATED-0812345678", email: "", ...(address === undefined ? {} : { address }) }) });
  const text = await response.text();
  return { response, data: text ? JSON.parse(text) : null };
}

assert((await createBuyer()).response.status === 400, "missing buyer address rejected");
assert((await createBuyer("   \n ")).response.status === 400, "blank buyer address rejected");
const accepted = await createBuyer("No. 81\nKeyzer Street\nColombo 11");
assert(accepted.response.status === 201 && accepted.data.address === "No. 81\nKeyzer Street\nColombo 11", "valid multiline buyer address accepted");
