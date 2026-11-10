import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * DESTRUCTIVE LOCAL-ONLY ACTION
 *
 * Replaces the selectable buyer catalogue in the local Wrangler D1 state.
 * Referenced legacy buyers are retained as inactive so foreign keys and saved
 * order/job snapshots stay intact. Run explicitly with:
 *   npx tsx scripts/replace-local-buyers.ts --confirm
 */
if (!process.argv.includes("--confirm")) {
  throw new Error("Destructive buyer replacement blocked. Run with --confirm.");
}

type BuyerRow = { name: string; address: string };
const root = process.cwd();
const env = { ...process.env, XDG_CONFIG_HOME: `${root}\\.wrangler\\xdg` };
const wranglerCli = join(root, "node_modules", "wrangler", "wrangler-dist", "cli.js");
const run = (args: string[]) => execFileSync(process.execPath, [wranglerCli, ...args], { cwd: root, env, encoding: "utf8" });
const query = (sql: string) => JSON.parse(run(["d1", "execute", "rich-time-db", "--local", "--persist-to", ".wrangler/state", "--command", sql, "--json"]));
const sqlText = (value: string) => `'${value.replaceAll("'", "''")}'`;

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) {
      values.push(value); value = "";
    } else value += character;
  }
  values.push(value);
  if (quoted) throw new Error("Unterminated CSV quote.");
  return values;
}

const lines = readFileSync(join(root, "buyers.csv"), "utf8").replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim() !== "");
if (lines.shift() !== "name,address") throw new Error("buyers.csv must start with name,address.");
const buyers: BuyerRow[] = lines.map((line, index) => {
  const columns = parseCsvLine(line);
  if (columns.length !== 2) throw new Error(`CSV row ${index + 2} must have exactly name and address.`);
  return { name: columns[0].trim(), address: columns[1].trim() };
});
const pairKey = (buyer: BuyerRow) => `${buyer.name}\u0000${buyer.address}`;
if (buyers.length !== 166) throw new Error(`Expected 166 buyers, found ${buyers.length}.`);
if (buyers.some((buyer) => !buyer.name || !buyer.address)) throw new Error("Each buyer needs a non-empty name and address.");
if (new Set(buyers.map(pairKey)).size !== buyers.length) throw new Error("The CSV has duplicate name/address pairs.");
if (buyers[0].name !== "A M LEATHER" || buyers[0].address !== "PILIYANDALA") throw new Error("The required first buyer is missing.");
if (buyers.at(-1)?.name !== "ZEENIYAS" || buyers.at(-1)?.address !== "GALLE") throw new Error("The required last buyer is missing.");

const before = query("SELECT COUNT(*) AS active_buyers FROM buyers WHERE active=1;")[0]?.results?.[0];
const statements = [
  "-- The imported catalogue is the only selectable catalogue.",
  "UPDATE buyers SET active=0, updated_at=CURRENT_TIMESTAMP WHERE active=1;",
  ...buyers.flatMap((buyer) => [
    `UPDATE buyers SET active=1, phone='', email=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=(SELECT MIN(id) FROM buyers WHERE full_name=${sqlText(buyer.name)} AND address=${sqlText(buyer.address)});`,
    `INSERT INTO buyers(full_name,phone,email,address,active) SELECT ${sqlText(buyer.name)},'',NULL,${sqlText(buyer.address)},1 WHERE NOT EXISTS(SELECT 1 FROM buyers WHERE full_name=${sqlText(buyer.name)} AND address=${sqlText(buyer.address)});`,
  ]),
  // Only unreferenced legacy records can be physically removed. Referenced rows
  // stay inactive to retain the foreign key and historical snapshots.
  "DELETE FROM buyers WHERE active=0 AND id NOT IN (SELECT buyer_id FROM quotations) AND id NOT IN (SELECT buyer_id FROM job_items WHERE buyer_id IS NOT NULL);",
].join("\n");
const importSql = join(root, ".local-backups", "replace-local-buyers.generated.sql");
writeFileSync(importSql, statements, "utf8");
run(["d1", "execute", "rich-time-db", "--local", "--persist-to", ".wrangler/state", "--file", importSql]);

const verification = query(`
  SELECT
    (SELECT COUNT(*) FROM buyers WHERE active=1) AS active_buyers,
    (SELECT COUNT(*) FROM buyers WHERE active=0) AS inactive_buyers,
    (SELECT COUNT(*) FROM buyers WHERE active=0 AND id IN (SELECT buyer_id FROM quotations UNION SELECT buyer_id FROM job_items WHERE buyer_id IS NOT NULL)) AS retained_referenced_buyers,
    (SELECT COUNT(*) FROM (SELECT full_name,address FROM buyers WHERE active=1 GROUP BY full_name,address HAVING COUNT(*)>1)) AS duplicate_active_pairs,
    (SELECT COUNT(*) FROM buyers WHERE active=1 AND full_name='A M LEATHER' AND address='PILIYANDALA') AS first_present,
    (SELECT COUNT(*) FROM buyers WHERE active=1 AND full_name='ZEENIYAS' AND address='GALLE') AS last_present;
`)[0]?.results?.[0];
if (!verification || verification.active_buyers !== 166 || verification.duplicate_active_pairs !== 0 || verification.first_present !== 1 || verification.last_present !== 1) {
  throw new Error(`Buyer replacement verification failed: ${JSON.stringify(verification)}`);
}

console.log(JSON.stringify({
  previousActiveBuyers: before?.active_buyers ?? 0,
  activeImportedBuyers: verification.active_buyers,
  retainedInactiveReferencedBuyers: verification.retained_referenced_buyers,
  inactiveBuyers: verification.inactive_buyers,
  duplicateActivePairs: verification.duplicate_active_pairs,
}, null, 2));
