/** Generates local-only VAPID settings without printing either key. */
import { readFile, writeFile } from "node:fs/promises";
import { generateVapidKeys } from "@mmmike/web-push/vapid";
const path = ".dev.vars";
const existing = await readFile(path, "utf8").catch(() => "");
if (/^VAPID_PRIVATE_KEY=/m.test(existing) || /^VAPID_PUBLIC_KEY=/m.test(existing)) {
  console.log("VAPID settings already exist in .dev.vars; no values were changed or displayed.");
} else {
  const keys = await generateVapidKeys();
  await writeFile(path, `${existing.replace(/\s*$/, "")}\nVAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}\n`);
  console.log("Local VAPID settings were added to .dev.vars. Private values were not displayed.");
}
