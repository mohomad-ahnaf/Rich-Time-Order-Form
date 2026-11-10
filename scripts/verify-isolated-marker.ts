const base = process.env.TEST_BASE_URL;
const username = process.env.TEST_ADMIN_USERNAME;
const password = process.env.TEST_ADMIN_PASSWORD;
const expected = process.env.TEST_ISOLATION_MARKER;

if (!base || !username || !password || !expected) throw new Error("Missing isolated marker verification environment.");

const login = await fetch(`${base}/api/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ username, password }),
});
if (login.status !== 204) throw new Error(`Marker login failed: ${login.status}`);
const cookie = login.headers.get("set-cookie")?.split(";")[0];
if (!cookie) throw new Error("Marker login did not return a session cookie.");
const response = await fetch(`${base}/api/test/isolation-marker`, { headers: { cookie } });
const body = await response.json().catch(() => null) as { marker?: string } | null;
if (!response.ok || body?.marker !== expected) throw new Error(`Isolated marker mismatch: status=${response.status} expected=${expected} observed=${body?.marker || "<missing>"}`);
console.log(JSON.stringify({ ok: true, markerVerified: true }));
