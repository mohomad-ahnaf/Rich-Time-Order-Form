/** Focused maintenance checks for the existing marker-guarded manual isolated Worker. */
const base = process.env.TEST_BASE_URL;
const password = process.env.TEST_ADMIN_PASSWORD;
const expectedMarker = process.env.TEST_ISOLATION_MARKER;
if (!base || !password || !expectedMarker) throw new Error("Missing manual isolated environment.");
type Session = { cookie: string; csrf: string; role: string; maintenanceCapable: boolean };
const expect = (value: unknown, message: string): asserts value => { if (!value) throw Error(message); };
async function login(username: string, expectedRole: "ADMIN" | "REP" | "STOREKEEPER", expectedMaintenanceCapability = false): Promise<Session> {
  const response = await fetch(`${base}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) });
  expect(response.status === 204, `login ${username}: ${response.status}`);
  const cookie = response.headers.get("set-cookie")?.split(";")[0] || "";
  const session = await fetch(`${base}/api/session`, { headers: { cookie } });
  expect(session.ok, `session ${username}: ${session.status}`);
  const data = await session.json() as { csrfToken?: string; role?: string; maintenanceCapable?: boolean };
  expect(data.csrfToken && data.role === expectedRole && Boolean(data.maintenanceCapable) === expectedMaintenanceCapability, `fixture preflight failed for ${username}: expected ${expectedRole}/${expectedMaintenanceCapability ? "maintenance-capable" : "not maintenance-capable"}`);
  return { cookie, csrf: data.csrfToken, role: data.role, maintenanceCapable: Boolean(data.maintenanceCapable) };
}
async function request(session: Session, path: string, init: RequestInit = {}) {
  const response = await fetch(`${base}${path}`, { ...init, headers: { cookie: session.cookie, "X-CSRF-Token": session.csrf, "content-type": "application/json", ...init.headers } });
  return { response, body: await response.json().catch(() => null) as any };
}
async function main() {
  const developer = await login("Developer", "ADMIN", true);
  const marker = await fetch(`${base}/api/test/isolation-marker`, { headers: { cookie: developer.cookie } });
  expect(marker.ok && (await marker.json()).marker === expectedMarker, "marker mismatch");
  const initial = await fetch(`${base}/api/maintenance/status`);
  expect(initial.ok && !(await initial.json()).maintenance, "maintenance must start disabled");
  const otherAdmin = await login("OtherAdmin", "ADMIN");
  const rep = await login("maintenance-rep", "REP"), storekeeper = await login("maintenance-store", "STOREKEEPER");
  for (const [name, session] of [["ordinary Admin", otherAdmin], ["Rep", rep], ["Storekeeper", storekeeper]] as const) {
    const denied = await request(session, "/api/maintenance", { method: "PUT", body: JSON.stringify({ enabled: true }) });
    expect(denied.response.status === 403, `${name} maintenance control: ${denied.response.status}`);
  }
  const enabled = await request(developer, "/api/maintenance", { method: "PUT", body: JSON.stringify({ enabled: true }) });
  expect(enabled.response.ok && enabled.body.enabled === 1, "Developer enables maintenance");
  for (const [name, session] of [["ordinary Admin", otherAdmin], ["Rep", rep], ["Storekeeper", storekeeper]] as const) {
    const blocked = await request(session, "/api/products");
    expect(blocked.response.status === 503 && blocked.body.code === "MAINTENANCE_MODE", `${name} blocked read`);
    const blockedWrite = await request(session, "/api/buyers", { method: "POST", body: JSON.stringify({ full_name: "Blocked", phone: "", address: "Blocked" }) });
    expect(blockedWrite.response.status === 503 && blockedWrite.body.code === "MAINTENANCE_MODE", `${name} blocked write`);
  }
  expect((await request(developer, "/api/products")).response.ok, "Developer retains business access");
  expect((await request(developer, "/api/logout", { method: "POST", body: JSON.stringify({}) })).response.status === 204, "Developer logout");
  const developerAgain = await login("Developer", "ADMIN", true);
  const audit = await request(developerAgain, "/api/test/maintenance-audit");
  expect(audit.response.ok && audit.body.some((row: any) => row.enabled === 1 && row.actor_username === "Developer" && row.created_at), "enable audit row");
  const disabled = await request(developerAgain, "/api/maintenance", { method: "PUT", body: JSON.stringify({ enabled: false }) });
  expect(disabled.response.ok && disabled.body.enabled === 0, "Developer disables maintenance");
  expect((await request(rep, "/api/products")).response.ok, "existing Rep session restored after maintenance");
  const finalAudit = await request(developerAgain, "/api/test/maintenance-audit");
  expect(finalAudit.response.ok && finalAudit.body.some((row: any) => row.enabled === 0 && row.actor_username === "Developer" && row.created_at), "disable audit row");
  console.log(JSON.stringify({ ok: true, checks: ["fixture-preflight", "default-disabled", "capability-control", "503-read-write", "developer-login-recovery", "session-preservation", "audit"] }));
}
main().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
