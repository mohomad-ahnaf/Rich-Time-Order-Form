import { Hono } from "hono";
import { z } from "zod";
import { sendPushNotification } from "@mmmike/web-push/send";
type Role = "ADMIN" | "REP" | "STOREKEEPER";
type User = {
    id: number;
    username: string;
    username_normalized: string;
    password_hash: string;
    role: Role;
    active: number;
    session_version: number;
    deleted_at: string | null;
};
type Bindings = {
    DB: D1Database;
    ASSETS: {
        fetch(request: Request): Promise<Response>;
    };
    OWNER_USERNAME: string;
    OWNER_PASSWORD_HASH: string;
    SESSION_SECRET: string;
    VAPID_PUBLIC_KEY?: string;
    VAPID_PRIVATE_KEY?: string;
    VAPID_SUBJECT?: string;
    PUSH_TEST_MODE?: string;
};
type Vars = {
    user: User;
    csrf: string;
    sessionId: string;
};
const app = new Hono<{
    Bindings: Bindings;
    Variables: Vars;
}>();
const encoder = new TextEncoder();
// Deliberately process-local and reachable only from guarded test routes below.
// It is never enabled from a request or normal production configuration.
const pushTestCalls = new Map<string, number>();
const json = (data: unknown, status = 200) => Response.json(data, { status });
const fail = (message: string, status = 400) => json({ error: message }, status);
const normalizeUsername = (value: string) => value.trim().toLocaleLowerCase();
const text = z.string().trim().min(1).max(200);
const optional = z.string().trim().max(2000).optional().nullable();
const vapidSubject = (env: Bindings) => /^(mailto:|https:\/\/)/.test(env.VAPID_SUBJECT || "") ? env.VAPID_SUBJECT! : null;
const password = z.string().min(1).max(256);
const userSelect = "id,username,username_normalized,password_hash,COALESCE(role_v2,role) AS role,active,session_version,deleted_at";
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
async function opaqueSubscriptionId(endpoint: string) { return b64(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(endpoint)))).slice(0, 12); }
const allowlistedProviderReason = (body: unknown) => { const value = typeof body === "string" ? body : ""; const match = value.match(/(?:BadJwtToken|UnauthorizedRegistration|InvalidToken|InvalidProviderToken|ExpiredProviderToken|InvalidSignature|InvalidAudience)/i); return match ? match[0] : "provider_rejected"; };
const unb64 = (value: string) => Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (character) => character.charCodeAt(0));
async function hmac(secret: string, data: string) { const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); return b64(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(data)))); }
async function derivePassword(value: string, salt: Uint8Array, iterations: number) { const key = await crypto.subtle.importKey("raw", encoder.encode(value), "PBKDF2", false, ["deriveBits"]); return b64(new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256))); }
async function hashPassword(value: string) { const salt = crypto.getRandomValues(new Uint8Array(16)); const iterations = 210000; return `pbkdf2$${iterations}$${b64(salt)}$${await derivePassword(value, salt, iterations)}`; }
async function verifyPassword(value: string, stored: string) { const [kind, iterations, salt, expected] = stored.split("$"); if (kind !== "pbkdf2" || !iterations || !salt || !expected)
    return false; const got = await derivePassword(value, unb64(salt), Number(iterations)); let different = got.length ^ expected.length; for (let i = 0; i < Math.max(got.length, expected.length); i += 1)
    different |= (got.charCodeAt(i) || 0) ^ (expected.charCodeAt(i) || 0); return different === 0; }
async function ensureLegacyAdmin(env: Bindings) { let admin = await env.DB.prepare(`SELECT ${userSelect} FROM users WHERE role='ADMIN' AND deleted_at IS NULL ORDER BY id LIMIT 1`).first<User>(); if (!admin) {
    const username = env.OWNER_USERNAME.trim();
    const normalized = normalizeUsername(username);
    if (!username || !normalized || !env.OWNER_PASSWORD_HASH)
        return null;
    await env.DB.prepare("INSERT OR IGNORE INTO users(username,username_normalized,password_hash,role,active) VALUES(?,?,?,?,1)").bind(username, normalized, env.OWNER_PASSWORD_HASH, "ADMIN").run();
    admin = await env.DB.prepare(`SELECT ${userSelect} FROM users WHERE username_normalized=?`).bind(normalized).first<User>();
} if (admin)
    await env.DB.prepare("UPDATE quotations SET created_by_user_id=? WHERE created_by_user_id IS NULL").bind(admin.id).run(); return admin || null; }
const sessionCookie = (request: Request, token: string, maxAge = 90 * 24 * 60 * 60) => `rt_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${request.url.startsWith("https:") ? "; Secure" : ""}`;
async function makeSession(env: Bindings, user: User) { const id = crypto.randomUUID(); const csrf = crypto.randomUUID(); await env.DB.prepare("INSERT INTO user_sessions(id,user_id,session_version,csrf,expires_at) VALUES(?,?,?,?,datetime('now','+90 days'))").bind(id, user.id, user.session_version, csrf).run(); return { id, csrf }; }
async function getSession(env: Bindings, request: Request) { const id = (request.headers.get("cookie") || "").match(/(?:^|;\s*)rt_session=([^;]+)/)?.[1]; if (!id) return null; const row = await env.DB.prepare("SELECT s.id AS session_id,s.csrf,s.session_version AS stored_session_version,u.id,u.username,u.username_normalized,u.password_hash,COALESCE(u.role_v2,u.role) AS role,u.active,u.session_version,u.deleted_at FROM user_sessions s JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.revoked_at IS NULL AND s.expires_at>CURRENT_TIMESTAMP").bind(id).first<any>(); if (!row || row.deleted_at || !row.active || row.stored_session_version !== row.session_version) return null; const user = { id: row.id, username: row.username, username_normalized: row.username_normalized, password_hash: row.password_hash, role: row.role, active: row.active, session_version: row.session_version, deleted_at: row.deleted_at } as User; await env.DB.prepare("UPDATE user_sessions SET last_seen_at=CURRENT_TIMESTAMP,expires_at=datetime('now','+90 days') WHERE id=? AND revoked_at IS NULL").bind(id).run(); return { user, csrf: row.csrf, sessionId: id }; }
const attempts = new Map<string, {
    count: number;
    reset: number;
}>();
app.post("/api/login", async (c) => { await ensureLegacyAdmin(c.env); const ip = c.req.header("CF-Connecting-IP") || "local"; const now = Date.now(); const attempt = attempts.get(ip); if (attempt && attempt.reset > now && attempt.count >= 5)
    return fail("Too many login attempts. Try again later.", 429); const body = await c.req.json().catch(() => null); if (!body || typeof body.username !== "string" || typeof body.password !== "string" || !body.password.length || body.password.length > 256)
    return fail("Username and password are required"); const user = await c.env.DB.prepare(`SELECT ${userSelect} FROM users WHERE username_normalized=?`).bind(normalizeUsername(body.username)).first<User>(); const valid = !!user && !user.deleted_at && !!user.active && await verifyPassword(body.password, user.password_hash); if (!valid) {
    attempts.set(ip, { count: (attempt?.reset > now ? attempt.count : 0) + 1, reset: now + 15 * 60000 });
    return fail("Invalid username or password", 401);
} attempts.delete(ip); const session = await makeSession(c.env, user); return new Response(null, { status: 204, headers: { "Set-Cookie": sessionCookie(c.req.raw, session.id) } }); });
app.use("/api/*", async (c, next) => { await ensureLegacyAdmin(c.env); const session = await getSession(c.env, c.req.raw); if (!session)
    return fail("Authentication required", 401); c.header("Cache-Control", "no-store, no-cache, must-revalidate, private"); c.header("Pragma", "no-cache"); c.header("Set-Cookie", sessionCookie(c.req.raw, session.sessionId)); c.set("user", session.user); c.set("csrf", session.csrf); c.set("sessionId", session.sessionId); if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method) && c.req.header("X-CSRF-Token") !== session.csrf)
    return fail("Invalid request token", 403); await next(); });
const requireAdmin = (c: {
    get(name: "user"): User;
}) => c.get("user").role === "ADMIN" ? null : fail("Administrator access required", 403);
const requireOrderMaker = (c: { get(name: "user"): User }) => c.get("user").role === "STOREKEEPER" ? fail("Storekeepers cannot create orders", 403) : null;
const requireNotStorekeeper = (c: { get(name: "user"): User }) => c.get("user").role === "STOREKEEPER" ? fail("Storekeeper access is limited to dispatch orders", 403) : null;
const revokeUserSessions = (db: D1Database, userId: number) => db.prepare("UPDATE user_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE user_id=? AND revoked_at IS NULL").bind(userId).run();
const disableUserSubscriptions = (db: D1Database, userId: number) => db.prepare("UPDATE push_subscriptions SET disabled_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND disabled_at IS NULL").bind(userId).run();
app.get("/api/session", c => json({ userId: c.get("user").id, username: c.get("user").username, role: c.get("user").role, csrfToken: c.get("csrf") }));
app.post("/api/logout", async (c) => { await c.env.DB.prepare("UPDATE user_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE id=?").bind(c.get("sessionId")).run(); return new Response(null, { status: 204, headers: { "Set-Cookie": sessionCookie(c.req.raw, "", 0) } }); });
type NotificationRecipient = { id: number; username: string };
async function notify(db: D1Database, recipients: NotificationRecipient[], actorId: number, eventKey: string, type: string, message: string, targetType?: "order" | "order-pending" | "job", targetId?: number) {
    const safeMessage = message.replace(/[\r\n]+/g, " ").trim().slice(0, 500);
    const unique = [...new Map(recipients.filter((recipient) => recipient.id !== actorId).map((recipient) => [recipient.id, recipient])).values()];
    if (!safeMessage || !unique.length) return;
    await db.batch(unique.map((recipient) => db.prepare("INSERT OR IGNORE INTO notifications(recipient_user_id,type,message,target_type,target_id,event_key) VALUES(?,?,?,?,?,?)").bind(recipient.id, type, safeMessage, targetType || null, targetId || null, eventKey)));
    for (const recipient of unique) { const row = await db.prepare("SELECT id FROM notifications WHERE recipient_user_id=? AND event_key=?").bind(recipient.id, eventKey).first<{ id: number }>(); if (row) { const outbox = await db.prepare("INSERT OR IGNORE INTO notification_outbox(notification_id,next_attempt_at) VALUES(?,CURRENT_TIMESTAMP)").bind(row.id).run(); console.log(`notification ${outbox.meta.changes ? "queued" : "deduplicated"} id=${row.id} type=${type} recipient=${recipient.id}`); } }
}
function scheduleEventPush(c: { env: Bindings; executionCtx: ExecutionContext }, eventKey: string, label: string) {
    c.executionCtx.waitUntil(deliverPushOutbox(c.env, undefined, undefined, eventKey).catch((error) => console.warn(`${label} notification scheduling failed: ${(error as Error).name || "Error"}`)));
}
async function deliverPushOutbox(env: Bindings, userId?: number, endpoint?: string, eventKey?: string) {
    const subject = vapidSubject(env); if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !subject) return;
    const due = await env.DB.prepare(`SELECT o.id AS outbox_id,n.id,n.type,n.message,n.target_type,n.target_id,n.recipient_user_id,COALESCE(p.private_lock_screen,0) AS private_lock_screen FROM notification_outbox o JOIN notifications n ON n.id=o.notification_id JOIN users u ON u.id=n.recipient_user_id LEFT JOIN notification_preferences p ON p.user_id=n.recipient_user_id WHERE u.active=1 AND u.deleted_at IS NULL AND o.delivered_at IS NULL AND o.failed_at IS NULL AND o.next_attempt_at<=CURRENT_TIMESTAMP AND (o.locked_until IS NULL OR o.locked_until<CURRENT_TIMESTAMP) ${userId ? "AND n.recipient_user_id=?" : ""} ${eventKey ? "AND n.event_key=?" : ""} ORDER BY o.id LIMIT 10`).bind(...(userId ? [userId] : []), ...(eventKey ? [eventKey] : [])).all();
    for (const item of due.results as any[]) {
        const claim = crypto.randomUUID();
        const claimed = await env.DB.prepare("UPDATE notification_outbox SET claim_token=?,locked_until=datetime('now','+1 minute'),updated_at=CURRENT_TIMESTAMP WHERE id=? AND delivered_at IS NULL AND failed_at IS NULL AND next_attempt_at<=CURRENT_TIMESTAMP AND (locked_until IS NULL OR locked_until<CURRENT_TIMESTAMP)").bind(claim, item.outbox_id).run();
        if (!claimed.meta.changes) continue;
        console.log(`push delivery claimed notification=${item.id} outbox=${item.outbox_id}`);
        const attempts = await env.DB.prepare("SELECT attempts FROM notification_outbox WHERE id=?").bind(item.outbox_id).first<{ attempts: number }>();
        const subscriptions = (await env.DB.prepare(`SELECT id,endpoint,p256dh,auth FROM push_subscriptions WHERE user_id=? AND disabled_at IS NULL ${endpoint ? "AND endpoint=?" : ""}`).bind(item.recipient_user_id, ...(endpoint ? [endpoint] : [])).all()).results as any[];
        let transient = false; let permanent = false; let diagnostic = "";
        for (const subscription of subscriptions) try {
            const device = await opaqueSubscriptionId(subscription.endpoint);
            // A local-only deterministic transport keeps integration tests away from real push providers.
            const calls = (pushTestCalls.get(subscription.endpoint) || 0) + 1;
            if (env.PUSH_TEST_MODE === "1") pushTestCalls.set(subscription.endpoint, calls);
            if (env.PUSH_TEST_MODE === "1" && (subscription.endpoint.includes("push-test-transient") && (!subscription.endpoint.includes("once") || calls === 1))) throw Error("mock transient push failure");
            const targetPath = item.target_type === "order-pending" ? "/?notification=order-pending" : item.target_type === "order" ? "/?notification=order" : item.target_type === "job" ? "/?notification=job" : "/";
            const unread = await env.DB.prepare("SELECT COUNT(*) AS count FROM notifications WHERE recipient_user_id=? AND read_at IS NULL").bind(item.recipient_user_id).first<{ count: number }>();
            const title = item.type === "DAILY_PENDING_DISPATCH_ADMIN" || item.type === "DAILY_PENDING_DISPATCH_STOREKEEPER" ? "Daily dispatch reminder" : item.type === "DAILY_PENDING_DISPATCH_REP" ? "Daily order update" : "RSK Holdings";
            const delivered = env.PUSH_TEST_MODE === "1" ? !subscription.endpoint.includes("push-test-expired") : await sendPushNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, { title, body: item.private_lock_screen ? "You have a new update in RSK Holdings." : item.message, url: targetPath, tag: `rsk-notification-${item.id}`, badgeCount: unread?.count || 0 }, { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject });
            if (!delivered) { await env.DB.prepare("UPDATE push_subscriptions SET disabled_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(subscription.id).run(); console.warn(`push delivery expired notification=${item.id} device=${device}`); }
            else console.log(`push provider accepted notification=${item.id} device=${device}`);
        } catch (error) {
            const failure = error as { name?: string; message?: string; statusCode?: number; retryAfterMs?: number };
            const status = typeof failure.statusCode === "number" ? failure.statusCode : undefined;
            const stage = status ? "provider_response" : failure.name === "InvalidSubscriptionError" ? "payload_encryption" : failure.name === "TimeoutError" || failure.name === "AbortError" || failure.name === "TypeError" ? "outbound_fetch" : "vapid_or_encryption";
            const reason = status === 401 || status === 403 ? `provider_auth:${allowlistedProviderReason((failure as any).body)}` : status === 413 ? "payload_rejected" : status === 429 ? "rate_limited" : failure.name === "InvalidSubscriptionError" ? "invalid_subscription" : failure.name === "TimeoutError" || failure.name === "AbortError" ? "network_timeout" : failure.name === "TypeError" ? "network_or_tls" : "runtime_error";
            permanent = failure.name === "InvalidSubscriptionError" || status === 400 || status === 401 || status === 403 || status === 413;
            transient = !permanent;
            diagnostic = `stage=${stage} reason=${reason}${status ? ` status=${status}` : ""} error=${(failure.name || "Error").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40)}`;
            console.warn(`push delivery failed notification=${item.id} device=${await opaqueSubscriptionId((failure as any).endpoint || "unknown")} attempt=${(attempts?.attempts || 0) + 1} ${diagnostic}`);
        }
        if (transient && (attempts?.attempts || 0) < 3) { const nextRetry = new Date(Date.now() + ((attempts?.attempts || 0) + 1) * 5 * 60_000).toISOString().replace("T", " ").replace("Z", ""); await env.DB.prepare("UPDATE notification_outbox SET attempts=attempts+1,next_attempt_at=?,last_error=?,claim_token=NULL,locked_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND claim_token=?").bind(nextRetry, diagnostic || "transient push failure", item.outbox_id, claim).run(); console.warn(`push retry scheduled notification=${item.id} next_retry=${nextRetry}`); }
        else await env.DB.prepare(`UPDATE notification_outbox SET ${transient || permanent ? "attempts=attempts+1,failed_at=CURRENT_TIMESTAMP,last_error=?" : "delivered_at=CURRENT_TIMESTAMP"},claim_token=NULL,locked_until=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND claim_token=?`).bind(...(transient || permanent ? [diagnostic || "push delivery failed"] : []), item.outbox_id, claim).run();
    }
}
async function activeRecipients(db: D1Database, roles: Role[]) {
    if (!roles.length) return [] as NotificationRecipient[];
    return (await db.prepare(`SELECT id,username FROM users WHERE active=1 AND deleted_at IS NULL AND COALESCE(role_v2,role) IN (${roles.map(() => "?").join(",")})`).bind(...roles).all()).results as NotificationRecipient[];
}
const colomboDate = (date = new Date()) => {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Colombo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
    const value = (type: string) => parts.find((part) => part.type === type)?.value || "";
    return `${value("year")}-${value("month")}-${value("day")}`;
};
const pendingReminderMessage = (role: Role, count: number) => {
    if (role === "REP") return count === 0 ? "None of your orders are pending dispatch." : `Good morning! ${count} of your order${count === 1 ? " is" : "s are"} pending dispatch.`;
    return count === 0 ? "No orders are pending dispatch." : `Good morning! ${count} order${count === 1 ? " is" : "s are"} pending dispatch.`;
};
async function pendingDispatchCount(db: D1Database, user: NotificationRecipient & { role: Role }) {
    const shared = "deleted_at IS NULL AND dispatched_at IS NULL AND cancelled_at IS NULL";
    if (user.role === "ADMIN") return (await db.prepare(`SELECT COUNT(*) AS count FROM quotations WHERE ${shared}`).first<{ count: number }>())?.count || 0;
    if (user.role === "STOREKEEPER") return (await db.prepare(`SELECT COUNT(*) AS count FROM quotations WHERE ${shared} AND hidden_at IS NULL`).first<{ count: number }>())?.count || 0;
    return (await db.prepare(`SELECT COUNT(*) AS count FROM quotations WHERE ${shared} AND hidden_at IS NULL AND created_by_user_id=?`).bind(user.id).first<{ count: number }>())?.count || 0;
}
async function runDailyPendingDispatchReminder(env: Bindings, now = new Date()) {
    const date = colomboDate(now);
    const recipients = (await env.DB.prepare("SELECT id,username,COALESCE(role_v2,role) AS role FROM users WHERE active=1 AND deleted_at IS NULL AND COALESCE(role_v2,role) IN ('ADMIN','REP','STOREKEEPER') ORDER BY id").all()).results as Array<NotificationRecipient & { role: Role }>;
    for (let index = 0; index < recipients.length; index += 10) {
        for (const recipient of recipients.slice(index, index + 10)) {
            const count = await pendingDispatchCount(env.DB, recipient);
            const eventKey = `daily-pending-dispatch:${date}:${recipient.id}`;
            const type = recipient.role === "REP" ? "DAILY_PENDING_DISPATCH_REP" : recipient.role === "ADMIN" ? "DAILY_PENDING_DISPATCH_ADMIN" : "DAILY_PENDING_DISPATCH_STOREKEEPER";
            await notify(env.DB, [recipient], 0, eventKey, type, pendingReminderMessage(recipient.role, count), "order-pending");
            await deliverPushOutbox(env, undefined, undefined, eventKey);
        }
    }
}
const notificationId = z.number().int().positive();
app.get("/api/notifications", async (c) => {
    const limit = Math.min(50, Math.max(1, Number(c.req.query("limit") || 25)));
    const before = Number(c.req.query("before") || 0);
    const user = c.get("user");
    const rows = await c.env.DB.prepare(`SELECT id,type,message,target_type,target_id,read_at,created_at FROM notifications WHERE recipient_user_id=? ${before ? "AND id<?" : ""} ORDER BY id DESC LIMIT ?`).bind(user.id, ...(before ? [before] : []), limit).all();
    const unread = await c.env.DB.prepare("SELECT COUNT(*) AS count FROM notifications WHERE recipient_user_id=? AND read_at IS NULL").bind(user.id).first<{ count: number }>();
    return json({ notifications: rows.results, unread: unread?.count || 0, nextBefore: rows.results.length === limit ? (rows.results[rows.results.length - 1] as any).id : null });
});
app.put("/api/notifications/:id/read", async (c) => { const parsed = notificationId.safeParse(Number(c.req.param("id"))); if (!parsed.success) return fail("Invalid notification"); await c.env.DB.prepare("UPDATE notifications SET read_at=COALESCE(read_at,CURRENT_TIMESTAMP) WHERE id=? AND recipient_user_id=?").bind(parsed.data, c.get("user").id).run(); return json({ ok: true }); });
app.get("/api/notifications/:id/delivery", async (c) => { const parsed = notificationId.safeParse(Number(c.req.param("id"))); if (!parsed.success) return fail("Invalid notification"); const row = await c.env.DB.prepare("SELECT n.id,n.recipient_user_id,n.type,n.read_at,n.created_at,o.attempts,o.next_attempt_at,o.delivered_at,o.failed_at,o.last_error,o.locked_until FROM notifications n LEFT JOIN notification_outbox o ON o.notification_id=n.id WHERE n.id=? AND n.recipient_user_id=?").bind(parsed.data, c.get("user").id).first(); return row ? json(row) : fail("Notification not found", 404); });
app.put("/api/notifications/read-all", async (c) => { await c.env.DB.prepare("UPDATE notifications SET read_at=CURRENT_TIMESTAMP WHERE recipient_user_id=? AND read_at IS NULL").bind(c.get("user").id).run(); return json({ ok: true }); });
app.get("/api/notifications/preferences", async (c) => { const row = await c.env.DB.prepare("SELECT private_lock_screen FROM notification_preferences WHERE user_id=?").bind(c.get("user").id).first<{ private_lock_screen: number }>(); return json({ privateLockScreen: Boolean(row?.private_lock_screen) }); });
app.put("/api/notifications/preferences", async (c) => { const parsed = z.object({ privateLockScreen: z.boolean() }).safeParse(await c.req.json()); if (!parsed.success) return fail("Invalid notification preference"); await c.env.DB.prepare("INSERT INTO notification_preferences(user_id,private_lock_screen) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET private_lock_screen=excluded.private_lock_screen,updated_at=CURRENT_TIMESTAMP").bind(c.get("user").id, parsed.data.privateLockScreen ? 1 : 0).run(); return json({ privateLockScreen: parsed.data.privateLockScreen }); });
app.get("/api/push/public-key", c => c.env.VAPID_PUBLIC_KEY && c.env.VAPID_PRIVATE_KEY && vapidSubject(c.env) ? json({ publicKey: c.env.VAPID_PUBLIC_KEY }) : fail("Phone notifications are not configured with a valid contact subject", 503));
const pushSubscriptionSchema = z.object({ endpoint: z.string().url().max(2000), keys: z.object({ p256dh: z.string().min(1).max(500), auth: z.string().min(1).max(500) }) });
app.post("/api/push/subscriptions", async (c) => { const parsed = pushSubscriptionSchema.safeParse(await c.req.json()); if (!parsed.success || !parsed.data.endpoint.startsWith("https://")) return fail("Invalid push subscription"); const user = c.get("user"); await c.env.DB.prepare("INSERT INTO push_subscriptions(user_id,endpoint,p256dh,auth,disabled_at,updated_at) VALUES(?,?,?,?,NULL,CURRENT_TIMESTAMP) ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,p256dh=excluded.p256dh,auth=excluded.auth,disabled_at=NULL,updated_at=CURRENT_TIMESTAMP").bind(user.id, parsed.data.endpoint, parsed.data.keys.p256dh, parsed.data.keys.auth).run(); return json({ ok: true }, 201); });
app.delete("/api/push/subscriptions", async (c) => { const parsed = z.object({ endpoint: z.string().url().max(2000) }).safeParse(await c.req.json()); if (!parsed.success) return fail("Invalid push subscription"); await c.env.DB.prepare("UPDATE push_subscriptions SET disabled_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE endpoint=? AND user_id=?").bind(parsed.data.endpoint, c.get("user").id).run(); return new Response(null, { status: 204 }); });
app.get("/api/test/push-state", async (c) => { if (c.env.PUSH_TEST_MODE !== "1") return fail("Not found", 404); const denied = requireAdmin(c); if (denied) return denied; return json({ calls: Object.fromEntries(pushTestCalls) }); });
app.post("/api/test/push-reset", async (c) => { if (c.env.PUSH_TEST_MODE !== "1") return fail("Not found", 404); const denied = requireAdmin(c); if (denied) return denied; pushTestCalls.clear(); return json({ ok: true }); });
app.get("/api/test/isolation-marker", async (c) => { if (c.env.PUSH_TEST_MODE !== "1") return fail("Not found", 404); const denied = requireAdmin(c); if (denied) return denied; return json(await c.env.DB.prepare("SELECT marker FROM __isolated_harness_marker WHERE id=1").first()); });
const accountSchema = z.object({ username: text.max(100), password, role: z.enum(["REP", "STOREKEEPER"]).default("REP") });
app.get("/api/accounts", async (c) => { const denied = requireAdmin(c); if (denied)
    return denied; const rows = await c.env.DB.prepare("SELECT id,username,COALESCE(role_v2,role) AS role,active,created_at,updated_at FROM users WHERE deleted_at IS NULL ORDER BY COALESCE(role_v2,role) DESC,username_normalized").all(); return json(rows.results); });
app.post("/api/accounts", async (c) => { const denied = requireAdmin(c); if (denied)
    return denied; const parsed = accountSchema.safeParse(await c.req.json()); if (!parsed.success)
    return fail("Username and password are required"); try {
    const result = await c.env.DB.prepare("INSERT INTO users(username,username_normalized,password_hash,role,role_v2,active) VALUES(?,?,?,?,?,1)").bind(parsed.data.username.trim(), normalizeUsername(parsed.data.username), await hashPassword(parsed.data.password), "REP", parsed.data.role).run();
    return json(await c.env.DB.prepare("SELECT id,username,COALESCE(role_v2,role) AS role,active,created_at,updated_at FROM users WHERE id=?").bind(result.meta.last_row_id).first(), 201);
}
catch {
    return fail("Username is already in use", 409);
} });
app.put("/api/accounts/:id", async (c) => { const denied = requireAdmin(c); if (denied)
    return denied; const id = Number(c.req.param("id")); const body = await c.req.json().catch(() => null); if (!body || typeof body.active !== "number" || ![0, 1].includes(body.active))
    return fail("Invalid account status"); const target = await c.env.DB.prepare(`SELECT ${userSelect} FROM users WHERE id=?`).bind(id).first<User>(); if (!target)
    return fail("Account not found", 404); if (target.id === c.get("user").id && !body.active)
    return fail("You cannot deactivate your own account", 422); if (target.role === "ADMIN" && target.active && !body.active) {
    const admins = await c.env.DB.prepare("SELECT COUNT(*) AS count FROM users WHERE role='ADMIN' AND active=1").first<{
        count: number;
    }>();
    if ((admins?.count || 0) <= 1)
        return fail("At least one active Admin is required", 422);
} await c.env.DB.prepare("UPDATE users SET active=?,session_version=session_version+?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(body.active, body.active ? 0 : 1, id).run(); if (!body.active) { await revokeUserSessions(c.env.DB, id); await disableUserSubscriptions(c.env.DB, id); } return json({ ok: true }); });
app.delete("/api/accounts/:id", async (c) => { const denied = requireAdmin(c); if (denied)
    return denied; const id = Number(c.req.param("id")); const target = await c.env.DB.prepare(`SELECT ${userSelect} FROM users WHERE id=? AND deleted_at IS NULL`).bind(id).first<User>(); if (!target)
    return fail("Account not found", 404); if (target.role === "ADMIN")
    return fail("Admin accounts cannot be deleted", 422); await c.env.DB.prepare("UPDATE users SET active=0,deleted_at=CURRENT_TIMESTAMP,session_version=session_version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(id).run(); await revokeUserSessions(c.env.DB, id); await disableUserSubscriptions(c.env.DB, id); return json({ ok: true }); });
app.post("/api/accounts/:id/reset-password", async (c) => { const denied = requireAdmin(c); if (denied)
    return denied; const parsed = z.object({ password }).safeParse(await c.req.json()); if (!parsed.success)
    return fail("Password must contain 1 to 256 characters"); const id = Number(c.req.param("id")); const target = await c.env.DB.prepare("SELECT id,username FROM users WHERE id=? AND deleted_at IS NULL").bind(id).first<{ id:number; username:string }>(); if (!target)
    return fail("Account not found", 404); await c.env.DB.prepare("UPDATE users SET password_hash=?,session_version=session_version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(await hashPassword(parsed.data.password), id).run(); await revokeUserSessions(c.env.DB, id); const actor=c.get("user"); await notify(c.env.DB,[target],actor.id,`account:${id}:password-reset:${Date.now()}`,"PASSWORD_RESET","Your password was reset. Sign in again with the new password."); return json({ ok: true }); });
app.post("/api/account/password", async (c) => { const parsed = z.object({ currentPassword: password, newPassword: password }).safeParse(await c.req.json()); if (!parsed.success)
    return fail("Passwords must contain 1 to 256 characters"); const user = c.get("user"); if (!await verifyPassword(parsed.data.currentPassword, user.password_hash))
    return fail("Current password is incorrect", 403); await c.env.DB.prepare("UPDATE users SET password_hash=?,session_version=session_version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(await hashPassword(parsed.data.newPassword), user.id).run(); await revokeUserSessions(c.env.DB, user.id); return json({ ok: true }); });
const buyerAddress = z.string().trim().min(1, "Address is required").max(2000);
const buyerSchema = z.object({ full_name: text, phone: z.string().trim().max(40).optional().or(z.literal("")).transform(value => value || ""), email: z.string().trim().email().max(200).optional().or(z.literal("")).transform(value => value || null), address: buyerAddress, active: z.number().int().min(0).max(1).optional() });
app.get("/api/buyers", async (c) => { const denied = requireNotStorekeeper(c); if (denied) return denied; const q = (c.req.query("q") || "").trim(); const rows = await c.env.DB.prepare("SELECT * FROM buyers WHERE active=1 AND (LOWER(full_name) LIKE LOWER(?) OR phone LIKE ? OR LOWER(COALESCE(address,'')) LIKE LOWER(?)) ORDER BY full_name").bind(`%${q}%`, `%${q}%`, `%${q}%`).all(); return json(rows.results); });
app.post("/api/buyers", async (c) => { const denied = requireNotStorekeeper(c); if (denied) return denied; const parsed = buyerSchema.safeParse(await c.req.json()); if (!parsed.success)
    return fail("Invalid buyer details"); const result = await c.env.DB.prepare("INSERT INTO buyers(full_name,phone,email,address,active) VALUES(?,?,?,?,1)").bind(parsed.data.full_name, parsed.data.phone, parsed.data.email, parsed.data.address).run(); return json(await c.env.DB.prepare("SELECT * FROM buyers WHERE id=?").bind(result.meta.last_row_id).first(), 201); });
app.put("/api/buyers/:id", async (c) => { const denied = requireNotStorekeeper(c); if (denied) return denied; const parsed = buyerSchema.safeParse(await c.req.json()); if (!parsed.success)
    return fail("Invalid buyer details"); await c.env.DB.prepare("UPDATE buyers SET full_name=?,phone=?,email=?,address=?,active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(parsed.data.full_name, parsed.data.phone, parsed.data.email, parsed.data.address, parsed.data.active ?? 1, Number(c.req.param("id"))).run(); return json({ ok: true }); });
const productPrice = z.number().int().min(0);
const simpleProductSchema = z.object({ name: text, price_minor: productPrice, active: z.number().int().min(0).max(1).optional() });
const legacyProductSchema = z.object({ brand: text, model_name: z.string().trim().max(200), sku: text.max(100), colour: optional, description: optional, price_minor: productPrice, active: z.number().int().min(0).max(1).optional() });
type ProductInput = {
    brand: string;
    model_name: string;
    sku?: string;
    colour: string | null | undefined;
    description: string | null | undefined;
    price_minor: number;
    active?: number;
};
function readProductInput(value: unknown): ProductInput | null { const simple = simpleProductSchema.safeParse(value); if (simple.success)
    return { brand: simple.data.name, model_name: "", colour: null, description: null, price_minor: simple.data.price_minor, active: simple.data.active }; const legacy = legacyProductSchema.safeParse(value); return legacy.success ? legacy.data : null; }
app.get("/api/products", async (c) => { const denied = requireNotStorekeeper(c); if (denied) return denied; const q = (c.req.query("q") || "").trim(); const admin = c.get("user").role === "ADMIN"; const rows = await c.env.DB.prepare(`SELECT * FROM products WHERE ${admin ? "1=1" : "active=1"} AND (LOWER(brand) LIKE LOWER(?) OR LOWER(model_name) LIKE LOWER(?) OR LOWER(sku) LIKE LOWER(?)) ORDER BY brand,model_name`).bind(`%${q}%`, `%${q}%`, `%${q}%`).all(); return json(rows.results); });
app.post("/api/products", async (c) => { const denied = requireAdmin(c); if (denied)
    return denied; const product = readProductInput(await c.req.json()); if (!product)
    return fail("Item name and a valid selling price are required"); try {
    const sku = product.sku || `AUTO-${crypto.randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase()}`;
    const result = await c.env.DB.prepare("INSERT INTO products(brand,model_name,sku,colour,description,price_minor,active) VALUES(?,?,?,?,?,?,1)").bind(product.brand, product.model_name, sku, product.colour, product.description, product.price_minor).run();
    return json(await c.env.DB.prepare("SELECT * FROM products WHERE id=?").bind(result.meta.last_row_id).first(), 201);
}
catch {
    return fail("SKU must be unique", 409);
} });
app.put("/api/products/:id", async (c) => { const denied = requireAdmin(c); if (denied)
    return denied; const id = Number(c.req.param("id")); const product = readProductInput(await c.req.json()); if (!product)
    return fail("Item name and a valid selling price are required"); const existing = await c.env.DB.prepare("SELECT * FROM products WHERE id=?").bind(id).first<any>(); if (!existing)
    return fail("Product not found", 404); try {
    const nextActive = product.active ?? existing.active;
    const notificationChanged = product.price_minor !== existing.price_minor || nextActive !== existing.active;
    await c.env.DB.prepare(`UPDATE products SET brand=?,model_name=?,sku=?,colour=?,description=?,price_minor=?,active=?,notification_revision=notification_revision+?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(product.brand, product.model_name, product.sku || existing.sku, product.colour, product.description, product.price_minor, nextActive, notificationChanged ? 1 : 0, id).run();
    const revision = notificationChanged ? await c.env.DB.prepare("SELECT notification_revision FROM products WHERE id=?").bind(id).first<{ notification_revision: number }>() : null;
    const recipients = await activeRecipients(c.env.DB, ["REP"]);
    const actor = c.get("user");
    const priceEventKey = `product:${id}:change:${revision?.notification_revision}:price`;
    const visibilityEventKey = `product:${id}:change:${revision?.notification_revision}:visibility`;
    if (product.price_minor !== existing.price_minor) await notify(c.env.DB, recipients, actor.id, priceEventKey, "PRODUCT_PRICE_CHANGED", `The minimum price for ${product.brand} was updated.`);
    if (nextActive !== existing.active) await notify(c.env.DB, recipients, actor.id, visibilityEventKey, nextActive ? "PRODUCT_UNHIDDEN" : "PRODUCT_HIDDEN", nextActive ? `${product.brand} is available again.` : `${product.brand} is no longer available.`);
    // Product changes notify active Reps immediately; cron remains recovery only.
    if (product.price_minor !== existing.price_minor) c.executionCtx.waitUntil(deliverPushOutbox(c.env, undefined, undefined, priceEventKey).catch((error) => console.warn(`product price notification scheduling failed: ${(error as Error).name || "Error"}`)));
    if (nextActive !== existing.active) c.executionCtx.waitUntil(deliverPushOutbox(c.env, undefined, undefined, visibilityEventKey).catch((error) => console.warn(`product visibility notification scheduling failed: ${(error as Error).name || "Error"}`)));
    return json({ ok: true });
}
catch {
    return fail("SKU must be unique", 409);
} });
app.delete("/api/products/:id", async (c) => { const denied = requireAdmin(c); if (denied)
    return denied; const id = Number(c.req.param("id")); const existing = await c.env.DB.prepare("SELECT brand FROM products WHERE id=?").bind(id).first<{ brand: string }>(); if (!existing) return fail("Product not found", 404); const used = await c.env.DB.prepare("SELECT COUNT(*) AS count FROM quotation_items WHERE product_id=?").bind(id).first<{
    count: number;
}>(); if ((used?.count || 0) > 0) {
    await c.env.DB.prepare("UPDATE products SET active=0,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(id).run();
    await notify(c.env.DB, await activeRecipients(c.env.DB, ["REP"]), c.get("user").id, `product:${id}:deleted`, "PRODUCT_HIDDEN", `${existing.brand} is no longer available.`);
    return json({ ok: true, hidden: true });
} await c.env.DB.prepare("DELETE FROM products WHERE id=?").bind(id).run(); await notify(c.env.DB, await activeRecipients(c.env.DB, ["REP"]), c.get("user").id, `product:${id}:deleted`, "PRODUCT_DELETED", "A product is no longer available."); return json({ ok: true, deleted: true }); });
const pdfHeaderSchema = z.object({ shop_name: z.string().trim().min(1).max(120), address: z.string().trim().min(1).max(500), phone: z.string().trim().min(1).max(60), document_title: z.string().trim().min(1).max(120) });
const dispatchTargetMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const dispatchTargetSchema = z.object({ month: dispatchTargetMonth, orderTarget: z.number().int().positive(), valueTargetMinor: z.number().int().positive(), version: z.number().int().positive().nullable() });
const currentColomboMonth = () => { const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Colombo", year: "numeric", month: "2-digit" }).formatToParts(new Date()); return `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}`; };
const colomboMonthBounds = (month: string) => {
    const [year, monthNumber] = month.split("-").map(Number);
    const at = (offset: number) => new Date(Date.UTC(year, monthNumber - 1 + offset, 1, -5, -30)).toISOString().replace("T", " ").replace(".000Z", "");
    return { start: at(0), end: at(1) };
};
app.get("/api/dispatch-targets", async (c) => {
    const denied = requireAdmin(c); if (denied) return denied;
    const month = c.req.query("month") || currentColomboMonth();
    if (!dispatchTargetMonth.safeParse(month).success) return fail("Invalid target month", 422);
    const bounds = colomboMonthBounds(month);
    const actual = await c.env.DB.prepare("SELECT COUNT(*) AS order_count,COALESCE(SUM(total_minor),0) AS value_minor FROM quotations WHERE deleted_at IS NULL AND cancelled_at IS NULL AND dispatched_at IS NOT NULL AND dispatched_at>=? AND dispatched_at<?").bind(bounds.start, bounds.end).first<{ order_count: number; value_minor: number }>();
    const target = await c.env.DB.prepare("SELECT month_key,order_target,value_target_minor,version,updated_by_username,updated_at FROM dispatch_targets WHERE month_key=?").bind(month).first();
    return json({ month, period: bounds, actual: { orders: actual?.order_count || 0, valueMinor: actual?.value_minor || 0 }, target: target || null, refreshedAt: new Date().toISOString() });
});
app.put("/api/dispatch-targets", async (c) => {
    const denied = requireAdmin(c); if (denied) return denied;
    const parsed = dispatchTargetSchema.safeParse(await c.req.json()); if (!parsed.success) return fail("Enter positive order and value targets.", 422);
    const value = parsed.data; const user = c.get("user");
    const current = await c.env.DB.prepare("SELECT version FROM dispatch_targets WHERE month_key=?").bind(value.month).first<{ version: number }>();
    if (current && value.version !== current.version) return fail("Targets changed elsewhere. Refresh and try again.", 409);
    if (!current && value.version !== null) return fail("Targets changed elsewhere. Refresh and try again.", 409);
    try {
        const result = current
            ? await c.env.DB.prepare("UPDATE dispatch_targets SET order_target=?,value_target_minor=?,version=version+1,updated_by_user_id=?,updated_by_username=?,updated_at=CURRENT_TIMESTAMP WHERE month_key=? AND version=?").bind(value.orderTarget, value.valueTargetMinor, user.id, user.username, value.month, value.version).run()
            : await c.env.DB.prepare("INSERT INTO dispatch_targets(month_key,order_target,value_target_minor,updated_by_user_id,updated_by_username) VALUES(?,?,?,?,?)").bind(value.month, value.orderTarget, value.valueTargetMinor, user.id, user.username).run();
        if (current && !result.meta.changes) return fail("Targets changed elsewhere. Refresh and try again.", 409);
    } catch { return fail("Targets changed elsewhere. Refresh and try again.", 409); }
    return json(await c.env.DB.prepare("SELECT month_key,order_target,value_target_minor,version,updated_by_username,updated_at FROM dispatch_targets WHERE month_key=?").bind(value.month).first());
});
app.get("/api/settings", async (c) => { const denied = requireNotStorekeeper(c); if (denied) return denied; return json(await c.env.DB.prepare("SELECT * FROM settings WHERE id=1").first()); });
app.put("/api/settings/pdf-header", async (c) => { const denied = requireAdmin(c); if (denied)
    return denied; const parsed = pdfHeaderSchema.safeParse(await c.req.json()); if (!parsed.success)
    return fail("Enter a shop name, address, phone number, and document title."); await c.env.DB.prepare("UPDATE settings SET shop_name=?,address=?,phone=?,pdf_document_title=?,updated_at=CURRENT_TIMESTAMP WHERE id=1").bind(parsed.data.shop_name, parsed.data.address, parsed.data.phone, parsed.data.document_title).run(); return json(await c.env.DB.prepare("SELECT * FROM settings WHERE id=1").first()); });
const jobTitle = z.string().trim().min(1).max(200);
const jobLocation = z.string().trim().min(1).max(200);
const jobDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable();
const jobSchema = z.object({ idempotencyKey: z.string().uuid(), repId: z.number().int().positive(), title: jobTitle, locationQuery: jobLocation, instructions: optional, dueDate: jobDate, buyerIds: z.array(z.number().int().positive()).min(1).max(500) }).refine((value) => new Set(value.buyerIds).size === value.buyerIds.length, "Duplicate buyers are not allowed");
const jobEditSchema = z.object({ title: jobTitle, instructions: optional, dueDate: jobDate });
const jobVisitSchema = z.object({ visited: z.boolean(), version: z.number().int().min(0) });
const jobCancelSchema = z.object({ reason: z.string().trim().min(1).max(1000) });
const jobResponseSchema = z.object({ response: z.enum(["ACCEPT", "REJECT"]), reason: z.string().trim().min(1).max(1000).optional() }).superRefine((value, context) => { if (value.response === "REJECT" && !value.reason) context.addIssue({ code: z.ZodIssueCode.custom, message: "A rejection reason is required" }); });
async function jobDetail(db: D1Database, id: number) {
    const job = await db.prepare("SELECT j.*,u.username AS current_rep_username FROM jobs j LEFT JOIN users u ON u.id=j.assigned_rep_user_id WHERE j.id=?").bind(id).first<any>();
    if (!job) return null;
    job.items = (await db.prepare("SELECT id,buyer_id,buyer_name,buyer_address,visited_at,visited_by_user_id,visited_by_username,version FROM job_items WHERE job_id=? ORDER BY buyer_name COLLATE NOCASE,id").bind(id).all()).results;
    job.progress = { visited: job.items.filter((item: any) => item.visited_at).length, total: job.items.length };
    return job;
}
async function canAccessJob(c: { env: Bindings; get(name: "user"): User }, id: number) {
    const job = await c.env.DB.prepare("SELECT id,assigned_rep_user_id FROM jobs WHERE id=?").bind(id).first<{ id: number; assigned_rep_user_id: number | null }>();
    if (!job) return null;
    return c.get("user").role === "ADMIN" || (c.get("user").role === "REP" && job.assigned_rep_user_id === c.get("user").id);
}
app.get("/api/jobs/buyer-preview", async (c) => {
    const denied = requireAdmin(c); if (denied) return denied;
    const q = (c.req.query("q") || "").trim();
    const rows = await c.env.DB.prepare("SELECT id,full_name,address FROM buyers WHERE active=1 AND LOWER(address) LIKE LOWER(?) ORDER BY full_name COLLATE NOCASE,id LIMIT 500").bind(`%${q}%`).all();
    return json(rows.results);
});
app.get("/api/jobs/address-suggestions", async (c) => {
    const denied = requireAdmin(c); if (denied) return denied;
    const q = (c.req.query("q") || "").trim();
    if (!q) return json([]);
    const rows = await c.env.DB.prepare("SELECT address FROM buyers WHERE active=1 AND LOWER(address) LIKE LOWER(?) GROUP BY LOWER(TRIM(address)) ORDER BY address COLLATE NOCASE LIMIT 50").bind(`%${q}%`).all();
    return json(rows.results);
});
app.get("/api/jobs", async (c) => {
    const user = c.get("user");
    if (user.role === "STOREKEEPER") return fail("Storekeepers cannot access jobs", 403);
    const requestedStatus = (c.req.query("status") || "").toLowerCase();
    const status = ["all", "active", "completed", "cancelled", "rejected"].includes(requestedStatus) ? requestedStatus.toUpperCase() : "ALL";
    const scoped = user.role === "ADMIN" ? "" : "AND j.assigned_rep_user_id=?";
    const statusSql = status === "ALL" ? "" : status === "REJECTED" ? "AND j.response_status='REJECTED'" : "AND j.status=?";
    const params: (string | number)[] = [];
    if (user.role !== "ADMIN") params.push(user.id);
    if (status !== "ALL" && status !== "REJECTED") params.push(status);
    const rows = (await c.env.DB.prepare(`SELECT j.id,j.title,j.location_query,j.instructions,j.due_date,j.assigned_rep_user_id,j.assigned_rep_username,j.status,j.response_status,j.responded_at,j.responded_by_username,j.rejection_reason,j.version,j.cancelled_at,j.cancellation_reason,j.created_at,j.updated_at, SUM(CASE WHEN ji.visited_at IS NOT NULL THEN 1 ELSE 0 END) AS visited_count,COUNT(ji.id) AS item_count FROM jobs j LEFT JOIN job_items ji ON ji.job_id=j.id WHERE 1=1 ${scoped} ${statusSql} GROUP BY j.id ORDER BY j.created_at DESC,j.id DESC`).bind(...params).all()).results;
    return json(rows);
});
app.get("/api/jobs/:id", async (c) => {
    const id = Number(c.req.param("id")); const allowed = await canAccessJob(c, id);
    if (allowed === null || !allowed) return fail("Job not found", 404);
    return json(await jobDetail(c.env.DB, id));
});
app.post("/api/jobs", async (c) => {
    const denied = requireAdmin(c); if (denied) return denied;
    const parsed = jobSchema.safeParse(await c.req.json()); if (!parsed.success) return fail("Enter an active Rep, title, address search, and at least one buyer.");
    const value = parsed.data; const user = c.get("user");
    const existing = await c.env.DB.prepare("SELECT id FROM jobs WHERE idempotency_key=? AND created_by_user_id=?").bind(value.idempotencyKey, user.id).first<{ id: number }>();
    if (existing) return json(await jobDetail(c.env.DB, existing.id));
    const rep = await c.env.DB.prepare(`SELECT ${userSelect} FROM users WHERE id=? AND COALESCE(role_v2,role)='REP' AND active=1 AND deleted_at IS NULL`).bind(value.repId).first<User>();
    if (!rep) return fail("Select an active Rep.", 422);
    const placeholders = value.buyerIds.map(() => "?").join(",");
    const buyers = (await c.env.DB.prepare(`SELECT id,full_name,address FROM buyers WHERE active=1 AND id IN (${placeholders})`).bind(...value.buyerIds).all()).results as any[];
    if (buyers.length !== value.buyerIds.length) return fail("One or more selected buyers are unavailable.", 422);
    const buyerById = new Map(buyers.map((buyer) => [buyer.id, buyer]));
    try {
        await c.env.DB.batch([
            c.env.DB.prepare("INSERT INTO jobs(idempotency_key,title,location_query,instructions,due_date,assigned_rep_user_id,assigned_rep_username,created_by_user_id,response_status) VALUES(?,?,?,?,?,?,?,?, 'AWAITING_RESPONSE')").bind(value.idempotencyKey, value.title, value.locationQuery, value.instructions || null, value.dueDate || null, rep.id, rep.username, user.id),
            ...value.buyerIds.map((buyerId) => { const buyer = buyerById.get(buyerId)!; return c.env.DB.prepare("INSERT INTO job_items(job_id,buyer_id,buyer_name,buyer_address) VALUES((SELECT id FROM jobs WHERE idempotency_key=?),?,?,?)").bind(value.idempotencyKey, buyer.id, buyer.full_name, buyer.address); }),
            c.env.DB.prepare("INSERT INTO job_audit(job_id,action,actor_user_id,actor_username,detail) VALUES((SELECT id FROM jobs WHERE idempotency_key=?),'ASSIGNED',?,?,?)").bind(value.idempotencyKey, user.id, user.username, `Assigned to ${rep.username}`),
        ]);
    } catch {
        const raced = await c.env.DB.prepare("SELECT id FROM jobs WHERE idempotency_key=? AND created_by_user_id=?").bind(value.idempotencyKey, user.id).first<{ id: number }>();
        if (raced) return json(await jobDetail(c.env.DB, raced.id));
        return fail("Could not create job", 500);
    }
    const created = await c.env.DB.prepare("SELECT id FROM jobs WHERE idempotency_key=?").bind(value.idempotencyKey).first<{ id: number }>();
    const detail = await jobDetail(c.env.DB, created!.id);
    const eventKey = `job:${created!.id}:assigned`;
    await notify(c.env.DB, [{ id: rep.id, username: rep.username }], user.id, eventKey, "JOB_ASSIGNED", `New job: visit ${detail!.progress.total} shop${detail!.progress.total === 1 ? "" : "s"} in ${value.locationQuery}.`, "job", created!.id);
    scheduleEventPush(c, eventKey, "job assignment");
    return json(detail, 201);
});
app.post("/api/jobs/:id/response", async (c) => {
    const user = c.get("user");
    if (user.role !== "REP") return fail("Rep access required", 403);
    const parsed = jobResponseSchema.safeParse(await c.req.json());
    if (!parsed.success) return fail(parsed.error.issues[0]?.message || "Invalid job response", 422);
    const id = Number(c.req.param("id"));
    const requested = parsed.data.response === "ACCEPT" ? "ACCEPTED" : "REJECTED";
    const reason = requested === "REJECTED" ? parsed.data.reason!.trim() : null;
    const current = await c.env.DB.prepare("SELECT id,assigned_rep_user_id,status,response_status FROM jobs WHERE id=?").bind(id).first<{ id: number; assigned_rep_user_id: number | null; status: string; response_status: string }>();
    if (!current || current.assigned_rep_user_id !== user.id) return fail("Job not found", 404);
    if (current.status === "CANCELLED") return fail("Cancelled jobs cannot be responded to", 422);
    if (current.response_status !== "AWAITING_RESPONSE") {
        if (current.response_status === requested) return json(await jobDetail(c.env.DB, id));
        return fail("This job already has a different response.", 409);
    }
    const update = c.env.DB.prepare("UPDATE jobs SET response_status=?,responded_at=CURRENT_TIMESTAMP,responded_by_user_id=?,responded_by_username=?,rejection_reason=?,updated_at=CURRENT_TIMESTAMP,version=version+1 WHERE id=? AND assigned_rep_user_id=? AND status!='CANCELLED' AND response_status='AWAITING_RESPONSE'").bind(requested, user.id, user.username, reason, id, user.id);
    const audit = c.env.DB.prepare("INSERT INTO job_response_audit(job_id,action,actor_user_id,actor_username,reason) SELECT ?,?,?,?,? WHERE changes()=1").bind(id, requested, user.id, user.username, reason);
    const results = await c.env.DB.batch([update, audit]);
    const changed = (results[0] as D1Result).meta.changes > 0;
    const detail = await jobDetail(c.env.DB, id);
    if (!detail || detail.status === "CANCELLED") return fail("Cancelled jobs cannot be responded to", 422);
    if (!changed) {
        if (detail.response_status === requested) return json(detail);
        return fail("This job already has a different response.", 409);
    }
    const verb = requested === "ACCEPTED" ? "accepted" : "rejected";
    const eventKey = `job:${id}:response:${requested}:${detail.version}`;
    await notify(c.env.DB, await activeRecipients(c.env.DB, ["ADMIN"]), user.id, eventKey, requested === "ACCEPTED" ? "JOB_ACCEPTED" : "JOB_REJECTED", `${user.username} ${verb} the job: ${detail.title}.`, "job", id);
    scheduleEventPush(c, eventKey, "job response");
    return json(detail);
});
app.put("/api/jobs/:id", async (c) => {
    const denied = requireAdmin(c); if (denied) return denied;
    const parsed = jobEditSchema.safeParse(await c.req.json()); if (!parsed.success) return fail("Invalid job details");
    const id = Number(c.req.param("id")); const result = await c.env.DB.prepare("UPDATE jobs SET title=?,instructions=?,due_date=?,updated_at=CURRENT_TIMESTAMP,version=version+1 WHERE id=? AND status!='CANCELLED'").bind(parsed.data.title, parsed.data.instructions || null, parsed.data.dueDate || null, id).run();
    if (!result.meta.changes) return fail("Active job not found", 404);
    const user = c.get("user"); await c.env.DB.prepare("INSERT INTO job_audit(job_id,action,actor_user_id,actor_username,detail) VALUES(?, 'UPDATED', ?, ?, 'Job details updated')").bind(id, user.id, user.username).run();
    const detail = await jobDetail(c.env.DB, id); const eventKey = `job:${id}:updated:${detail!.version}`; await notify(c.env.DB, [{ id: detail!.assigned_rep_user_id!, username: detail!.assigned_rep_username }], user.id, eventKey, "JOB_UPDATED", `Job updated: ${detail!.title}.`, "job", id); scheduleEventPush(c, eventKey, "job update");
    return json(detail);
});
app.post("/api/jobs/:id/cancel", async (c) => {
    const denied = requireAdmin(c); if (denied) return denied;
    const parsed = jobCancelSchema.safeParse(await c.req.json()); if (!parsed.success) return fail("A cancellation reason is required");
    const id = Number(c.req.param("id")); const user = c.get("user");
    const update = c.env.DB.prepare("UPDATE jobs SET status='CANCELLED',cancelled_at=CURRENT_TIMESTAMP,cancelled_by_user_id=?,cancellation_reason=?,updated_at=CURRENT_TIMESTAMP,version=version+1 WHERE id=? AND status!='CANCELLED'").bind(user.id, parsed.data.reason, id);
    const audit = c.env.DB.prepare("INSERT INTO job_audit(job_id,action,actor_user_id,actor_username,detail) SELECT ?, 'CANCELLED', ?, ?, ? WHERE changes()=1").bind(id, user.id, user.username, parsed.data.reason);
    await c.env.DB.batch([update, audit]);
    const result = await jobDetail(c.env.DB, id); if (!result || result.status !== "CANCELLED") return fail("Active job not found", 404); const eventKey = `job:${id}:cancelled`; await notify(c.env.DB, [{ id: result.assigned_rep_user_id!, username: result.assigned_rep_username }], user.id, eventKey, "JOB_CANCELLED", `Job cancelled: ${result.title}.`, "job", id); scheduleEventPush(c, eventKey, "job cancellation");
    return json(result);
});
app.put("/api/jobs/:id/items/:itemId", async (c) => {
    const user = c.get("user"); if (user.role !== "REP") return fail("Rep access required", 403);
    const parsed = jobVisitSchema.safeParse(await c.req.json()); if (!parsed.success) return fail("Invalid visit update");
    const id = Number(c.req.param("id")), itemId = Number(c.req.param("itemId"));
    const item = await c.env.DB.prepare("SELECT ji.id,ji.version,j.assigned_rep_user_id,j.status,j.response_status FROM job_items ji JOIN jobs j ON j.id=ji.job_id WHERE ji.id=? AND ji.job_id=?").bind(itemId, id).first<{ id: number; version: number; assigned_rep_user_id: number | null; status: string; response_status: string }>();
    if (!item || item.assigned_rep_user_id !== user.id) return fail("Job item not found", 404);
    if (item.status === "CANCELLED") return fail("Cancelled jobs are read-only", 422);
    if (item.response_status !== "ACCEPTED") return fail("Accept this job before updating visits.", 422);
    if (item.version !== parsed.data.version) return fail("This visit changed elsewhere. Refresh and try again.", 409);
    const update = await c.env.DB.prepare("UPDATE job_items SET visited_at=CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE NULL END,visited_by_user_id=CASE WHEN ? THEN ? ELSE NULL END,visited_by_username=CASE WHEN ? THEN ? ELSE NULL END,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND job_id=? AND version=? AND EXISTS(SELECT 1 FROM jobs WHERE id=? AND status!='CANCELLED' AND response_status='ACCEPTED')").bind(parsed.data.visited ? 1 : 0, parsed.data.visited ? 1 : 0, user.id, parsed.data.visited ? 1 : 0, user.username, itemId, id, parsed.data.version, id).run();
    if (!update.meta.changes) return fail("This visit changed elsewhere. Refresh and try again.", 409);
    const remaining = await c.env.DB.prepare("SELECT COUNT(*) AS count FROM job_items WHERE job_id=? AND visited_at IS NULL").bind(id).first<{ count: number }>();
    const nextStatus = (remaining?.count || 0) === 0 ? "COMPLETED" : "ACTIVE";
    const wasCompleted = item.status === "COMPLETED";
    await c.env.DB.batch([
        c.env.DB.prepare("UPDATE jobs SET status=?,updated_at=CURRENT_TIMESTAMP,version=version+1 WHERE id=? AND status!='CANCELLED'").bind(nextStatus, id),
        c.env.DB.prepare("INSERT INTO job_audit(job_id,job_item_id,action,actor_user_id,actor_username) VALUES(?,?,?,?,?)").bind(id, itemId, parsed.data.visited ? "VISITED" : "UNVISITED", user.id, user.username),
        ...(nextStatus === "COMPLETED" && !wasCompleted ? [c.env.DB.prepare("INSERT INTO job_audit(job_id,action,actor_user_id,actor_username) VALUES(?,?,?,?)").bind(id, "COMPLETED", user.id, user.username)] : []),
        ...(nextStatus === "ACTIVE" && wasCompleted ? [c.env.DB.prepare("INSERT INTO job_audit(job_id,action,actor_user_id,actor_username) VALUES(?,?,?,?)").bind(id, "REOPENED", user.id, user.username)] : []),
    ]);
    const detail = await jobDetail(c.env.DB, id);
    if ((nextStatus === "COMPLETED" && !wasCompleted) || (nextStatus === "ACTIVE" && wasCompleted)) {
        const eventKey = `job:${id}:${nextStatus.toLowerCase()}:${detail!.version}`;
        await notify(c.env.DB, await activeRecipients(c.env.DB, ["ADMIN"]), user.id, eventKey, nextStatus === "COMPLETED" ? "JOB_COMPLETED" : "JOB_REOPENED", nextStatus === "COMPLETED" ? `${user.username} completed all ${detail!.progress.total} visits in ${detail!.location_query}.` : `${user.username} reopened job ${detail!.title}.`, "job", id);
        scheduleEventPush(c, eventKey, nextStatus === "COMPLETED" ? "job completion" : "job reopening");
    }
    return json(detail);
});
const orderSchema = z.object({ idempotencyKey: z.string().uuid(), buyerId: z.number().int().positive(), quotationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(), notes: optional, items: z.array(z.object({ productId: z.number().int().positive(), quantity: z.number().int().min(1).max(9999), unitPriceMinor: z.number().int().min(0).optional() })).min(1).max(100) });
async function fullOrder(db: D1Database, id: number) { const order = await db.prepare("SELECT q.*,u.username AS creator_username FROM quotations q LEFT JOIN users u ON u.id=q.created_by_user_id WHERE q.id=?").bind(id).first<any>(); if (!order)
    return null; order.items = (await db.prepare("SELECT product_id,item_name,description,sku,quantity,unit_price_minor,row_total_minor,packing_checked FROM quotation_items WHERE quotation_id=?").bind(id).all()).results; return order; }
async function dispatchOrder(db: D1Database, id: number) {
    const order = await db.prepare("SELECT q.id,q.created_by_user_id,q.quotation_number,q.order_code,q.buyer_name,q.buyer_phone,q.buyer_address,q.quotation_date,q.created_at,q.dispatched_at,q.dispatched_by_user_id,q.dispatcher_username,q.dispatch_notes,q.delivery_reference,q.dispatch_version,q.cancelled_at,q.canceller_username,q.cancellation_reason,u.username AS creator_username FROM quotations q LEFT JOIN users u ON u.id=q.created_by_user_id WHERE q.id=?").bind(id).first<any>();
    if (!order) return null;
    order.items = (await db.prepare("SELECT product_id,item_name,description,sku,quantity,packing_checked FROM quotation_items WHERE quotation_id=? ORDER BY id").bind(id).all()).results;
    return order;
}
async function canAccessOrder(c: {
    env: Bindings;
    get(name: "user"): User;
}, id: number) { const order = await c.env.DB.prepare("SELECT id,created_by_user_id,hidden_at,deleted_at,dispatched_at FROM quotations WHERE id=?").bind(id).first<{
    id: number;
    created_by_user_id: number | null;
    hidden_at: string | null;
    deleted_at: string | null;
    dispatched_at: string | null;
}>(); if (!order || order.deleted_at)
    return null; const expiredDispatch = !!order.dispatched_at && Date.parse(`${order.dispatched_at.replace(" ", "T")}Z`) <= Date.now() - 30 * 24 * 60 * 60 * 1000; if (c.get("user").role === "STOREKEEPER") return order.hidden_at || expiredDispatch ? false : true; if (c.get("user").role !== "ADMIN" && (order.created_by_user_id !== c.get("user").id || order.hidden_at || expiredDispatch))
    return false; return true; }
app.post("/api/quotations/preview", async (c) => {
    const denied = requireOrderMaker(c); if (denied) return denied;
    const parsed = orderSchema.safeParse(await c.req.json());
    if (!parsed.success) return fail("Invalid order");
    const value = parsed.data;
    const user = c.get("user");
    const buyer = await c.env.DB.prepare("SELECT * FROM buyers WHERE id=? AND active=1").bind(value.buyerId).first<any>();
    if (!buyer) return fail("Buyer is unavailable", 422);
    const ids = [...new Set(value.items.map((item) => item.productId))];
    if (ids.length !== value.items.length) return fail("Duplicate products are not allowed", 422);
    const products = (await c.env.DB.prepare(`SELECT * FROM products WHERE active=1 AND id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all()).results as any[];
    if (products.length !== ids.length) return fail("One or more products are unavailable", 422);
    let total = 0;
    let pricingError = "";
    const items = value.items.map((item) => {
        const product = products.find((row) => row.id === item.productId)!;
        const unitPrice = item.unitPriceMinor ?? product.price_minor;
        if (user.role === "REP" && unitPrice < product.price_minor) pricingError = `Minimum price for ${product.brand} ${product.model_name} is LKR ${(product.price_minor / 100).toFixed(2)}.`;
        const rowTotal = unitPrice * item.quantity;
        total += rowTotal;
        return { product_id: product.id, item_name: `${product.brand} ${product.model_name}`.trim(), description: product.description, sku: product.sku, quantity: item.quantity, unit_price_minor: unitPrice, row_total_minor: rowTotal };
    });
    if (pricingError) return fail(pricingError, 422);
    const settings = await c.env.DB.prepare("SELECT * FROM settings WHERE id=1").first<any>();
    return json({ id: 0, quotation_number: "Draft", order_code: null, buyer_id: buyer.id, quotation_date: value.quotationDate, valid_until: value.validUntil || null, notes: value.notes || null, total_minor: total, buyer_name: buyer.full_name, buyer_phone: buyer.phone, buyer_email: buyer.email, buyer_address: buyer.address, shop_name: settings.shop_name, shop_phone: settings.phone, shop_email: settings.email, shop_address: settings.address, pdf_document_title: settings.pdf_document_title, created_at: new Date().toISOString(), items });
});
app.post("/api/quotations", async (c) => { const denied = requireOrderMaker(c); if (denied) return denied; const parsed = orderSchema.safeParse(await c.req.json()); if (!parsed.success)
    return fail("Invalid order"); const value = parsed.data; const user = c.get("user"); const existing = await c.env.DB.prepare("SELECT id,hidden_at,deleted_at FROM quotations WHERE idempotency_key=? AND created_by_user_id=?").bind(value.idempotencyKey, user.id).first<{
    id: number;
    hidden_at: string | null;
    deleted_at: string | null;
}>(); if (existing) {
    if (existing.deleted_at)
        return fail("This order was deleted and cannot be recreated.", 409);
    if (existing.hidden_at && user.role !== "ADMIN")
        return fail("Order not found", 404);
    return json(await fullOrder(c.env.DB, existing.id));
} const buyer = await c.env.DB.prepare("SELECT * FROM buyers WHERE id=? AND active=1").bind(value.buyerId).first<any>(); if (!buyer)
    return fail("Buyer is unavailable", 422); const ids = [...new Set(value.items.map(item => item.productId))]; if (ids.length !== value.items.length)
    return fail("Duplicate products are not allowed", 422); const products = (await c.env.DB.prepare(`SELECT * FROM products WHERE active=1 AND id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all()).results as any[]; if (products.length !== ids.length)
    return fail("One or more products are unavailable", 422); const settings = await c.env.DB.prepare("SELECT * FROM settings WHERE id=1").first<any>(); let total = 0; let pricingError = ""; const items = value.items.map(item => { const product = products.find(row => row.id === item.productId)!; const unitPrice = item.unitPriceMinor ?? product.price_minor; if (user.role === "REP" && unitPrice < product.price_minor)
    pricingError = `Minimum price for ${product.brand} ${product.model_name} is LKR ${(product.price_minor / 100).toFixed(2)}.`; const row = unitPrice * item.quantity; total += row; return { product, item, unitPrice, row }; }); if (pricingError)
    return fail(pricingError, 422); const number = `ORD-${value.quotationDate.replaceAll("-", "")}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`; const next = await c.env.DB.prepare("UPDATE order_code_sequence SET last_value=last_value+1 WHERE id=1 RETURNING last_value").first<{
    last_value: number;
}>(); if (!next)
    return fail("Could not allocate order code", 500); const orderCode = String(next.last_value).padStart(4, "0"); const insert = c.env.DB.prepare("INSERT INTO quotations(quotation_number,order_code,idempotency_key,buyer_id,created_by_user_id,quotation_date,valid_until,notes,total_minor,buyer_name,buyer_phone,buyer_email,buyer_address,shop_name,shop_phone,shop_email,shop_address,pdf_document_title) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(number, orderCode, value.idempotencyKey, value.buyerId, user.id, value.quotationDate, value.validUntil || null, value.notes || null, total, buyer.full_name, buyer.phone, buyer.email, buyer.address, settings.shop_name, settings.phone, settings.email, settings.address, settings.pdf_document_title); const itemStatements = items.map(({ product, item, unitPrice, row }) => c.env.DB.prepare("INSERT INTO quotation_items(quotation_id,product_id,item_name,description,sku,quantity,unit_price_minor,row_total_minor) VALUES((SELECT id FROM quotations WHERE idempotency_key=?),?,?,?,?,?,?,?)").bind(value.idempotencyKey, product.id, `${product.brand} ${product.model_name}`.trim(), product.description, product.sku, item.quantity, unitPrice, row)); try {
    await c.env.DB.batch([insert, ...itemStatements]);
    const saved = await c.env.DB.prepare("SELECT id FROM quotations WHERE idempotency_key=?").bind(value.idempotencyKey).first<{
        id: number;
    }>();
    const order = await fullOrder(c.env.DB, saved!.id); await notify(c.env.DB, await activeRecipients(c.env.DB, ["ADMIN", "STOREKEEPER"]), user.id, `order:${order!.id}:confirmed`, "ORDER_CONFIRMED", `${user.username} placed order ${order!.order_code || order!.quotation_number} for ${order!.buyer_name}.`, "order", order!.id); return json(order, 201);
}
catch {
    const raced = await c.env.DB.prepare("SELECT id,hidden_at,deleted_at FROM quotations WHERE idempotency_key=? AND created_by_user_id=?").bind(value.idempotencyKey, user.id).first<{
        id: number;
        hidden_at: string | null;
        deleted_at: string | null;
    }>();
    if (raced && !raced.deleted_at)
        if (raced.hidden_at && user.role !== "ADMIN")
            return fail("Order not found", 404);
    if (raced && !raced.deleted_at)
        return json(await fullOrder(c.env.DB, raced.id));
    if (raced?.deleted_at)
        return fail("This order was deleted and cannot be recreated.", 409);
    return fail("Could not save order", 409);
} });
app.get("/api/quotations", async (c) => {
    const q = (c.req.query("q") || "").trim().replace(/\s+/g, " ");
    const phone = q.replace(/[\s\-()]/g, "");
    const user = c.get("user");
    const status = ["all", "dispatched", "pending", "cancelled"].includes(c.req.query("status") || "") ? c.req.query("status")! : "all";
    const statusSql = status === "dispatched" ? "AND q.dispatched_at IS NOT NULL AND q.cancelled_at IS NULL" : status === "pending" ? "AND q.dispatched_at IS NULL AND q.cancelled_at IS NULL" : status === "cancelled" ? "AND q.cancelled_at IS NOT NULL" : "";
    if (user.role === "STOREKEEPER") {
        const sql = `SELECT q.id,q.quotation_number,q.order_code,q.buyer_name,q.buyer_address,q.buyer_phone,q.quotation_date,q.created_at,q.dispatched_at,q.dispatcher_username,q.delivery_reference,q.cancelled_at,q.canceller_username,u.username AS creator_username FROM quotations q LEFT JOIN users u ON u.id=q.created_by_user_id WHERE q.deleted_at IS NULL AND q.hidden_at IS NULL AND (q.dispatched_at IS NULL OR q.dispatched_at > datetime('now','-30 days')) ${statusSql} AND (LOWER(q.quotation_number) LIKE LOWER(?) OR LOWER(q.order_code) LIKE LOWER(?) OR LOWER(q.buyer_name) LIKE LOWER(?) OR LOWER(COALESCE(q.buyer_address,'')) LIKE LOWER(?)) ORDER BY q.created_at DESC,q.id DESC`;
        const rows = (await c.env.DB.prepare(sql).bind(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`).all()).results;
        const counts = await c.env.DB.prepare("SELECT SUM(CASE WHEN dispatched_at IS NULL AND cancelled_at IS NULL THEN 1 ELSE 0 END) AS pending, SUM(CASE WHEN dispatched_at IS NOT NULL AND cancelled_at IS NULL THEN 1 ELSE 0 END) AS dispatched, SUM(CASE WHEN cancelled_at IS NOT NULL THEN 1 ELSE 0 END) AS cancelled FROM quotations WHERE deleted_at IS NULL AND hidden_at IS NULL AND (dispatched_at IS NULL OR dispatched_at > datetime('now','-30 days'))").first<any>();
        return json({ orders: rows, counts: { pending: counts?.pending || 0, dispatched: counts?.dispatched || 0, cancelled: counts?.cancelled || 0 } });
    }
    const visibility = user.role === "ADMIN" ? "q.deleted_at IS NULL" : "q.deleted_at IS NULL AND q.hidden_at IS NULL";
    const scoped = user.role === "ADMIN" ? "" : "AND q.created_by_user_id=?";
    const dispatchAge = user.role === "ADMIN" ? "" : "AND (q.dispatched_at IS NULL OR q.dispatched_at > datetime('now','-30 days'))";
    const sql = `SELECT q.id,q.quotation_number,q.order_code,q.quotation_date,q.buyer_name,q.buyer_phone,q.buyer_address,q.total_minor,q.valid_until,q.hidden_at,q.dispatched_at,q.dispatcher_username,q.cancelled_at,q.canceller_username,q.created_at,u.username AS creator_username FROM quotations q LEFT JOIN users u ON u.id=q.created_by_user_id WHERE ${visibility} ${dispatchAge} ${statusSql} AND (LOWER(q.quotation_number) LIKE LOWER(?) OR LOWER(q.order_code) LIKE LOWER(?) OR LOWER(q.buyer_name) LIKE LOWER(?) OR LOWER(u.username) LIKE LOWER(?) OR REPLACE(REPLACE(REPLACE(REPLACE(q.buyer_phone,' ',''),'-',''),'(',''),')','') LIKE ?) ${scoped} ORDER BY q.created_at DESC,q.id DESC`;
    const args: (string | number)[] = [`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${phone}%`];
    if (user.role !== "ADMIN") args.push(user.id);
    return json((await c.env.DB.prepare(sql).bind(...args).all()).results);
});
app.get("/api/quotations/:id", async (c) => { const id = Number(c.req.param("id")); const allowed = await canAccessOrder(c, id); if (allowed === null || !allowed)
    return fail("Order not found", 404); return json(c.get("user").role === "STOREKEEPER" ? await dispatchOrder(c.env.DB, id) : await fullOrder(c.env.DB, id)); });
const packingSchema = z.object({ version: z.number().int().min(0), items: z.array(z.object({ productId: z.number().int().positive(), checked: z.boolean() })).min(1) });
app.put("/api/quotations/:id/packing", async (c) => {
    if (c.get("user").role !== "STOREKEEPER") return fail("Storekeeper access required", 403);
    const parsed = packingSchema.safeParse(await c.req.json()); if (!parsed.success) return fail("Invalid packing checklist");
    const id = Number(c.req.param("id")); const allowed = await canAccessOrder(c, id); if (!allowed) return fail("Order not found", 404);
    const order = await c.env.DB.prepare("SELECT dispatch_version,dispatched_at,cancelled_at FROM quotations WHERE id=? AND hidden_at IS NULL AND deleted_at IS NULL").bind(id).first<{ dispatch_version: number; dispatched_at: string | null; cancelled_at: string | null }>();
    if (!order) return fail("Order not found", 404); if (order.dispatched_at || order.cancelled_at) return fail("This order is not available for packing", 422);
    if (order.dispatch_version !== parsed.data.version) return fail("The packing checklist changed. Refresh and try again.", 409);
    const productIds = parsed.data.items.map(item => item.productId);
    const expected = await c.env.DB.prepare(`SELECT COUNT(*) AS count FROM quotation_items WHERE quotation_id=? AND product_id IN (${productIds.map(() => "?").join(",")})`).bind(id, ...productIds).first<{ count: number }>();
    if ((expected?.count || 0) !== productIds.length) return fail("Invalid packing checklist", 422);
    const nextVersion = order.dispatch_version + 1;
    const versionUpdate = await c.env.DB.prepare("UPDATE quotations SET dispatch_version=? WHERE id=? AND dispatch_version=? AND dispatched_at IS NULL AND hidden_at IS NULL AND deleted_at IS NULL").bind(nextVersion, id, order.dispatch_version).run();
    if ((versionUpdate.meta.changes || 0) !== 1) return fail("The packing checklist changed. Refresh and try again.", 409);
    await c.env.DB.batch(parsed.data.items.map(item => c.env.DB.prepare("UPDATE quotation_items SET packing_checked=? WHERE quotation_id=? AND product_id=?").bind(item.checked ? 1 : 0, id, item.productId)));
    return json(await dispatchOrder(c.env.DB, id));
});
const dispatchSchema = z.object({ notes: optional, deliveryReference: z.string().trim().max(200).optional().nullable() });
app.post("/api/quotations/:id/dispatch", async (c) => {
    if (c.get("user").role !== "STOREKEEPER") return fail("Storekeeper access required", 403);
    const parsed = dispatchSchema.safeParse(await c.req.json()); if (!parsed.success) return fail("Invalid dispatch details");
    const id = Number(c.req.param("id")); const allowed = await canAccessOrder(c, id); if (!allowed) return fail("Order not found", 404);
    const incomplete = await c.env.DB.prepare("SELECT COUNT(*) AS count FROM quotation_items WHERE quotation_id=? AND packing_checked=0").bind(id).first<{ count: number }>();
    if ((incomplete?.count || 0) > 0) return fail("Complete the packing checklist before dispatching.", 422);
    const user = c.get("user");
    const update = c.env.DB.prepare("UPDATE quotations SET dispatched_at=CURRENT_TIMESTAMP,dispatched_by_user_id=?,dispatcher_username=?,dispatch_notes=?,delivery_reference=?,dispatch_version=dispatch_version+1 WHERE id=? AND dispatched_at IS NULL AND cancelled_at IS NULL AND hidden_at IS NULL AND deleted_at IS NULL").bind(user.id, user.username, parsed.data.notes || null, parsed.data.deliveryReference || null, id);
    await c.env.DB.batch([update, c.env.DB.prepare("INSERT INTO order_dispatch_audit(quotation_id,action,actor_user_id,actor_username,reason) SELECT ?, 'DISPATCHED', ?, ?, ? WHERE changes()=1").bind(id, user.id, user.username, parsed.data.notes || null)]);
    const order = await dispatchOrder(c.env.DB, id); if (!order) return fail("Order not found", 404);
    await notify(c.env.DB, [...await activeRecipients(c.env.DB, ["ADMIN"]), ...(order.created_by_user_id ? [{ id: order.created_by_user_id, username: order.creator_username || "Rep" }] : [])], user.id, `order:${id}:dispatched`, "ORDER_DISPATCHED", `Order ${order.order_code || order.quotation_number} was dispatched by ${user.username}.`, "order", id); return json(order);
});
app.post("/api/quotations/:id/return-to-pending", async (c) => {
    const denied = requireAdmin(c); if (denied) return denied;
    const parsed = z.object({ reason: text.max(500) }).safeParse(await c.req.json()); if (!parsed.success) return fail("A reason is required");
    const id = Number(c.req.param("id"));
    const target = await c.env.DB.prepare("SELECT id FROM quotations WHERE id=? AND dispatched_at IS NOT NULL AND deleted_at IS NULL").bind(id).first<{ id: number }>(); if (!target) return fail("Dispatched order not found", 404);
    const user = c.get("user");
    await c.env.DB.batch([c.env.DB.prepare("UPDATE quotations SET dispatched_at=NULL,dispatched_by_user_id=NULL,dispatcher_username=NULL,dispatch_notes=NULL,delivery_reference=NULL,dispatch_version=dispatch_version+1 WHERE id=?").bind(id), c.env.DB.prepare("INSERT INTO order_dispatch_audit(quotation_id,action,actor_user_id,actor_username,reason) VALUES(?, 'RETURNED_TO_PENDING', ?, ?, ?)").bind(id, user.id, user.username, parsed.data.reason)]);
    const order = await fullOrder(c.env.DB, id); await notify(c.env.DB, [...await activeRecipients(c.env.DB, ["STOREKEEPER"]), ...(order!.created_by_user_id ? [{ id: order!.created_by_user_id, username: order!.creator_username || "Rep" }] : [])], user.id, `order:${id}:returned`, "ORDER_RETURNED", `Order ${order!.order_code || order!.quotation_number} was returned to pending.`, "order", id); return json(order);
});
app.post("/api/quotations/:id/cancel", async (c) => {
    const denied = requireAdmin(c); if (denied) return denied;
    const parsed = z.object({ reason: text.max(500) }).safeParse(await c.req.json()); if (!parsed.success) return fail("A cancellation reason is required");
    const id = Number(c.req.param("id")); const user = c.get("user");
    const update = c.env.DB.prepare("UPDATE quotations SET cancelled_at=CURRENT_TIMESTAMP,cancelled_by_user_id=?,canceller_username=?,cancellation_reason=? WHERE id=? AND dispatched_at IS NULL AND cancelled_at IS NULL AND deleted_at IS NULL").bind(user.id, user.username, parsed.data.reason, id);
    await c.env.DB.batch([update, c.env.DB.prepare("INSERT INTO order_status_audit(quotation_id,action,actor_user_id,actor_username,reason) SELECT ?, 'CANCELLED', ?, ?, ? WHERE changes()=1").bind(id, user.id, user.username, parsed.data.reason)]);
    const order = await fullOrder(c.env.DB, id); if (!order) return fail("Order not found", 404); if (!order.cancelled_at) return fail("Only pending orders can be cancelled", 422);
    await notify(c.env.DB, [...await activeRecipients(c.env.DB, ["STOREKEEPER"]), ...(order.created_by_user_id ? [{ id: order.created_by_user_id, username: order.creator_username || "Rep" }] : [])], user.id, `order:${id}:cancelled`, "ORDER_CANCELLED", `Order ${order.order_code || order.quotation_number} was cancelled. Reason: ${parsed.data.reason}.`, "order", id); return json(order);
});
app.put("/api/quotations/:id/visibility", async (c) => {
    const denied = requireAdmin(c);
    if (denied) return denied;
    const parsed = z.object({ hidden: z.boolean() }).safeParse(await c.req.json());
    if (!parsed.success) return fail("Invalid visibility request");
    const id = Number(c.req.param("id"));
    const target = await c.env.DB.prepare("SELECT id FROM quotations WHERE id=? AND deleted_at IS NULL").bind(id).first<{ id: number }>();
    if (!target) return fail("Order not found", 404);
    await c.env.DB.prepare("UPDATE quotations SET hidden_at=CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE NULL END WHERE id=? AND deleted_at IS NULL").bind(parsed.data.hidden ? 1 : 0, id).run();
    const order = await fullOrder(c.env.DB, id); const actor = c.get("user"); await notify(c.env.DB, [...await activeRecipients(c.env.DB, ["STOREKEEPER"]), ...(order!.created_by_user_id ? [{ id: order!.created_by_user_id, username: order!.creator_username || "Rep" }] : [])], actor.id, `order:${id}:visibility:${parsed.data.hidden ? "hidden" : "visible"}`, parsed.data.hidden ? "ORDER_HIDDEN" : "ORDER_UNHIDDEN", parsed.data.hidden ? "An order is no longer available." : "An order is available again.", "order", id); return json(order);
});
app.delete("/api/quotations/:id", async (c) => {
    const denied = requireAdmin(c);
    if (denied) return denied;
    const id = Number(c.req.param("id"));
    const target = await c.env.DB.prepare("SELECT id FROM quotations WHERE id=? AND deleted_at IS NULL").bind(id).first<{ id: number }>();
    if (!target) return fail("Order not found", 404);
    const order = await fullOrder(c.env.DB, id); await c.env.DB.prepare("UPDATE quotations SET deleted_at=CURRENT_TIMESTAMP WHERE id=? AND deleted_at IS NULL").bind(id).run(); const actor = c.get("user"); await notify(c.env.DB, [...await activeRecipients(c.env.DB, ["STOREKEEPER"]), ...(order?.created_by_user_id ? [{ id: order.created_by_user_id, username: order.creator_username || "Rep" }] : [])], actor.id, `order:${id}:deleted`, "ORDER_DELETED", "An order was removed.");
    return new Response(null, { status: 204 });
});
app.all("*", c => c.env.ASSETS.fetch(c.req.raw));
export default {
    fetch: app.fetch,
    scheduled: (controller: ScheduledController, env: Bindings, ctx: ExecutionContext) => {
        if (controller.cron === "0 4 * * *") ctx.waitUntil(runDailyPendingDispatchReminder(env).catch((error) => console.warn(`daily pending-dispatch reminder failed: ${(error as Error).name || "Error"}`)));
        ctx.waitUntil(deliverPushOutbox(env).catch(() => undefined));
    },
};
