import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

if (!process.argv.includes("--confirm")) {
  throw new Error("Destructive local reset blocked. Run: npm run db:reset:local");
}

const root = process.cwd();
const env = { ...process.env, XDG_CONFIG_HOME: `${root}\\.wrangler\\xdg` };
const wranglerCli = join(root, "node_modules", "wrangler", "wrangler-dist", "cli.js");
const run = (args: string[]) => execFileSync(process.execPath, [wranglerCli, ...args], { cwd: root, env, encoding: "utf8" });
const query = (sql: string) => JSON.parse(run(["d1", "execute", "rich-time-db", "--local", "--persist-to", ".wrangler/state", "--command", sql, "--json"]));
const result = query("SELECT id, username, role, active, COUNT(*) OVER () AS count FROM users WHERE username_normalized='admin' AND role='ADMIN' AND active=1 AND deleted_at IS NULL;");
const admin = result[0]?.results?.[0];
if (!admin || admin.count !== 1) throw new Error("Destructive local reset blocked: Admin could not be uniquely identified.");

run(["d1", "execute", "rich-time-db", "--local", "--persist-to", ".wrangler/state", "--file", "scripts/reset-local-rsk-catalog.sql"]);
const verification = query("SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM buyers) AS buyers, (SELECT COUNT(*) FROM quotations) AS orders, (SELECT COUNT(*) FROM quotation_items) AS order_items, (SELECT COUNT(*) FROM products WHERE active=1) AS active_products, (SELECT COUNT(*) FROM products) AS products, (SELECT COUNT(*) FROM (SELECT brand FROM products GROUP BY brand HAVING COUNT(*)>1)) AS duplicate_names, (SELECT COUNT(*) FROM (SELECT sku FROM products GROUP BY sku HAVING COUNT(*)>1)) AS duplicate_skus, (SELECT COUNT(*) FROM users WHERE id=" + Number(admin.id) + " AND username_normalized='admin' AND role='ADMIN' AND active=1) AS preserved_admin;");
const counts = verification[0]?.results?.[0];
if (!counts || counts.users !== 1 || counts.buyers !== 0 || counts.orders !== 0 || counts.order_items !== 0 || counts.products !== 56 || counts.active_products !== 56 || counts.duplicate_names !== 0 || counts.duplicate_skus !== 0 || counts.preserved_admin !== 1) throw new Error("Local reset verification failed.");
const expected = [...readFileSync("scripts/reset-local-rsk-catalog.sql", "utf8").matchAll(/\('([^']+)', '', 'RSK-CAT-\d+', NULL, NULL, (\d+), 1\)/g)].map((match) => ({ name: match[1], price_minor: Number(match[2]) }));
const actual = query("SELECT brand AS name, price_minor FROM products ORDER BY sku;")[0]?.results;
if (expected.length !== 56 || JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("Local catalog names or prices do not match the supplied catalog.");
const tiers = query("SELECT price_minor, COUNT(*) AS count FROM products GROUP BY price_minor ORDER BY price_minor;")[0]?.results;
const expectedTiers = [{ price_minor: 850000, count: 10 }, { price_minor: 950000, count: 4 }, { price_minor: 1650000, count: 18 }, { price_minor: 2050000, count: 24 }];
if (JSON.stringify(tiers) !== JSON.stringify(expectedTiers)) throw new Error("Local catalog price tiers do not match the supplied catalog.");
console.log("PASS destructive local reset/import: 1 Admin, 56 active catalog products, no buyers or orders.");
