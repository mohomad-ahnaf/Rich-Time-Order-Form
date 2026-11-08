import { Hono } from "hono";
import { z } from "zod";
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
};
type SessionPayload = {
    userId: number;
    username: string;
    role: Role;
    sessionVersion: number;
    exp: number;
    csrf: string;
};
type Vars = {
    user: User;
    csrf: string;
};
const app = new Hono<{
    Bindings: Bindings;
    Variables: Vars;
}>();
const encoder = new TextEncoder();
const json = (data: unknown, status = 200) => Response.json(data, { status });
const fail = (message: string, status = 400) => json({ error: message }, status);
const normalizeUsername = (value: string) => value.trim().toLocaleLowerCase();
const text = z.string().trim().min(1).max(200);
const optional = z.string().trim().max(2000).optional().nullable();
const password = z.string().min(1).max(256);
const userSelect = "id,username,username_normalized,password_hash,COALESCE(role_v2,role) AS role,active,session_version,deleted_at";
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
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
async function makeSession(env: Bindings, user: User) { const payload = b64(encoder.encode(JSON.stringify({ userId: user.id, username: user.username, role: user.role, sessionVersion: user.session_version, exp: Date.now() + 1000 * 60 * 60 * 12, csrf: crypto.randomUUID() }))); return `${payload}.${await hmac(env.SESSION_SECRET, payload)}`; }
async function getSession(env: Bindings, request: Request) { const token = (request.headers.get("cookie") || "").match(/(?:^|;\s*)rt_session=([^;]+)/)?.[1]; if (!token)
    return null; const [payload, signature] = token.split("."); if (!payload || !signature || signature !== await hmac(env.SESSION_SECRET, payload))
    return null; try {
    const parsed = JSON.parse(new TextDecoder().decode(unb64(payload))) as SessionPayload;
    if (parsed.exp <= Date.now())
        return null;
    const user = await env.DB.prepare(`SELECT ${userSelect} FROM users WHERE id=?`).bind(parsed.userId).first<User>();
    if (!user || user.deleted_at || !user.active || user.session_version !== parsed.sessionVersion || user.role !== parsed.role)
        return null;
    return { user, csrf: parsed.csrf };
}
catch {
    return null;
} }
const attempts = new Map<string, {
    count: number;
    reset: number;
}>();
app.post("/api/login", async (c) => { await ensureLegacyAdmin(c.env); const ip = c.req.header("CF-Connecting-IP") || "local"; const now = Date.now(); const attempt = attempts.get(ip); if (attempt && attempt.reset > now && attempt.count >= 5)
    return fail("Too many login attempts. Try again later.", 429); const body = await c.req.json().catch(() => null); if (!body || typeof body.username !== "string" || typeof body.password !== "string" || !body.password.length || body.password.length > 256)
    return fail("Username and password are required"); const user = await c.env.DB.prepare(`SELECT ${userSelect} FROM users WHERE username_normalized=?`).bind(normalizeUsername(body.username)).first<User>(); const valid = !!user && !user.deleted_at && !!user.active && await verifyPassword(body.password, user.password_hash); if (!valid) {
    attempts.set(ip, { count: (attempt?.reset > now ? attempt.count : 0) + 1, reset: now + 15 * 60000 });
    return fail("Invalid username or password", 401);
} attempts.delete(ip); const token = await makeSession(c.env, user); const secure = c.req.url.startsWith("https:") ? "; Secure" : ""; return new Response(null, { status: 204, headers: { "Set-Cookie": `rt_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure}` } }); });
app.use("/api/*", async (c, next) => { await ensureLegacyAdmin(c.env); const session = await getSession(c.env, c.req.raw); if (!session)
    return fail("Authentication required", 401); c.header("Cache-Control", "no-store, no-cache, must-revalidate, private"); c.header("Pragma", "no-cache"); c.set("user", session.user); c.set("csrf", session.csrf); if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method) && c.req.header("X-CSRF-Token") !== session.csrf)
    return fail("Invalid request token", 403); await next(); });
const requireAdmin = (c: {
    get(name: "user"): User;
}) => c.get("user").role === "ADMIN" ? null : fail("Administrator access required", 403);
const requireOrderMaker = (c: { get(name: "user"): User }) => c.get("user").role === "STOREKEEPER" ? fail("Storekeepers cannot create orders", 403) : null;
const requireNotStorekeeper = (c: { get(name: "user"): User }) => c.get("user").role === "STOREKEEPER" ? fail("Storekeeper access is limited to dispatch orders", 403) : null;
app.get("/api/session", c => json({ username: c.get("user").username, role: c.get("user").role, csrfToken: c.get("csrf") }));
app.post("/api/logout", () => new Response(null, { status: 204, headers: { "Set-Cookie": "rt_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0" } }));
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
} await c.env.DB.prepare("UPDATE users SET active=?,session_version=session_version+?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(body.active, body.active ? 0 : 1, id).run(); return json({ ok: true }); });
app.delete("/api/accounts/:id", async (c) => { const denied = requireAdmin(c); if (denied)
    return denied; const id = Number(c.req.param("id")); const target = await c.env.DB.prepare(`SELECT ${userSelect} FROM users WHERE id=? AND deleted_at IS NULL`).bind(id).first<User>(); if (!target)
    return fail("Account not found", 404); if (target.role === "ADMIN")
    return fail("Admin accounts cannot be deleted", 422); await c.env.DB.prepare("UPDATE users SET active=0,deleted_at=CURRENT_TIMESTAMP,session_version=session_version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(id).run(); return json({ ok: true }); });
app.post("/api/accounts/:id/reset-password", async (c) => { const denied = requireAdmin(c); if (denied)
    return denied; const parsed = z.object({ password }).safeParse(await c.req.json()); if (!parsed.success)
    return fail("Password must contain 1 to 256 characters"); const id = Number(c.req.param("id")); if (!await c.env.DB.prepare("SELECT id FROM users WHERE id=?").bind(id).first())
    return fail("Account not found", 404); await c.env.DB.prepare("UPDATE users SET password_hash=?,session_version=session_version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(await hashPassword(parsed.data.password), id).run(); return json({ ok: true }); });
app.post("/api/account/password", async (c) => { const parsed = z.object({ currentPassword: password, newPassword: password }).safeParse(await c.req.json()); if (!parsed.success)
    return fail("Passwords must contain 1 to 256 characters"); const user = c.get("user"); if (!await verifyPassword(parsed.data.currentPassword, user.password_hash))
    return fail("Current password is incorrect", 403); await c.env.DB.prepare("UPDATE users SET password_hash=?,session_version=session_version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(await hashPassword(parsed.data.newPassword), user.id).run(); return json({ ok: true }); });
const buyerAddress = z.string().trim().min(1, "Address is required").max(2000);
const buyerSchema = z.object({ full_name: text, phone: text.max(40), email: z.string().trim().email().max(200).optional().or(z.literal("")).transform(value => value || null), address: buyerAddress, active: z.number().int().min(0).max(1).optional() });
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
    await c.env.DB.prepare("UPDATE products SET brand=?,model_name=?,sku=?,colour=?,description=?,price_minor=?,active=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(product.brand, product.model_name, product.sku || existing.sku, product.colour, product.description, product.price_minor, product.active ?? existing.active, id).run();
    return json({ ok: true });
}
catch {
    return fail("SKU must be unique", 409);
} });
app.delete("/api/products/:id", async (c) => { const denied = requireAdmin(c); if (denied)
    return denied; const id = Number(c.req.param("id")); const used = await c.env.DB.prepare("SELECT COUNT(*) AS count FROM quotation_items WHERE product_id=?").bind(id).first<{
    count: number;
}>(); if ((used?.count || 0) > 0) {
    await c.env.DB.prepare("UPDATE products SET active=0,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(id).run();
    return json({ ok: true, hidden: true });
} await c.env.DB.prepare("DELETE FROM products WHERE id=?").bind(id).run(); return json({ ok: true, deleted: true }); });
const pdfHeaderSchema = z.object({ shop_name: z.string().trim().min(1).max(120), address: z.string().trim().min(1).max(500), phone: z.string().trim().min(1).max(60), document_title: z.string().trim().min(1).max(120) });
app.get("/api/settings", async (c) => { const denied = requireNotStorekeeper(c); if (denied) return denied; return json(await c.env.DB.prepare("SELECT * FROM settings WHERE id=1").first()); });
app.put("/api/settings/pdf-header", async (c) => { const denied = requireAdmin(c); if (denied)
    return denied; const parsed = pdfHeaderSchema.safeParse(await c.req.json()); if (!parsed.success)
    return fail("Enter a shop name, address, phone number, and document title."); await c.env.DB.prepare("UPDATE settings SET shop_name=?,address=?,phone=?,pdf_document_title=?,updated_at=CURRENT_TIMESTAMP WHERE id=1").bind(parsed.data.shop_name, parsed.data.address, parsed.data.phone, parsed.data.document_title).run(); return json(await c.env.DB.prepare("SELECT * FROM settings WHERE id=1").first()); });
const orderSchema = z.object({ idempotencyKey: z.string().uuid(), buyerId: z.number().int().positive(), quotationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(), notes: optional, items: z.array(z.object({ productId: z.number().int().positive(), quantity: z.number().int().min(1).max(9999), unitPriceMinor: z.number().int().min(0).optional() })).min(1).max(100) });
async function fullOrder(db: D1Database, id: number) { const order = await db.prepare("SELECT q.*,u.username AS creator_username FROM quotations q LEFT JOIN users u ON u.id=q.created_by_user_id WHERE q.id=?").bind(id).first<any>(); if (!order)
    return null; order.items = (await db.prepare("SELECT product_id,item_name,description,sku,quantity,unit_price_minor,row_total_minor,packing_checked FROM quotation_items WHERE quotation_id=?").bind(id).all()).results; return order; }
async function dispatchOrder(db: D1Database, id: number) {
    const order = await db.prepare("SELECT q.id,q.quotation_number,q.order_code,q.buyer_name,q.buyer_phone,q.buyer_address,q.quotation_date,q.created_at,q.dispatched_at,q.dispatched_by_user_id,q.dispatcher_username,q.dispatch_notes,q.delivery_reference,q.dispatch_version,q.cancelled_at,q.canceller_username,q.cancellation_reason,u.username AS creator_username FROM quotations q LEFT JOIN users u ON u.id=q.created_by_user_id WHERE q.id=?").bind(id).first<any>();
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
    return json(await fullOrder(c.env.DB, saved!.id), 201);
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
    return json(order);
});
app.post("/api/quotations/:id/return-to-pending", async (c) => {
    const denied = requireAdmin(c); if (denied) return denied;
    const parsed = z.object({ reason: text.max(500) }).safeParse(await c.req.json()); if (!parsed.success) return fail("A reason is required");
    const id = Number(c.req.param("id"));
    const target = await c.env.DB.prepare("SELECT id FROM quotations WHERE id=? AND dispatched_at IS NOT NULL AND deleted_at IS NULL").bind(id).first<{ id: number }>(); if (!target) return fail("Dispatched order not found", 404);
    const user = c.get("user");
    await c.env.DB.batch([c.env.DB.prepare("UPDATE quotations SET dispatched_at=NULL,dispatched_by_user_id=NULL,dispatcher_username=NULL,dispatch_notes=NULL,delivery_reference=NULL,dispatch_version=dispatch_version+1 WHERE id=?").bind(id), c.env.DB.prepare("INSERT INTO order_dispatch_audit(quotation_id,action,actor_user_id,actor_username,reason) VALUES(?, 'RETURNED_TO_PENDING', ?, ?, ?)").bind(id, user.id, user.username, parsed.data.reason)]);
    return json(await fullOrder(c.env.DB, id));
});
app.post("/api/quotations/:id/cancel", async (c) => {
    const denied = requireAdmin(c); if (denied) return denied;
    const parsed = z.object({ reason: text.max(500) }).safeParse(await c.req.json()); if (!parsed.success) return fail("A cancellation reason is required");
    const id = Number(c.req.param("id")); const user = c.get("user");
    const update = c.env.DB.prepare("UPDATE quotations SET cancelled_at=CURRENT_TIMESTAMP,cancelled_by_user_id=?,canceller_username=?,cancellation_reason=? WHERE id=? AND dispatched_at IS NULL AND cancelled_at IS NULL AND deleted_at IS NULL").bind(user.id, user.username, parsed.data.reason, id);
    await c.env.DB.batch([update, c.env.DB.prepare("INSERT INTO order_status_audit(quotation_id,action,actor_user_id,actor_username,reason) SELECT ?, 'CANCELLED', ?, ?, ? WHERE changes()=1").bind(id, user.id, user.username, parsed.data.reason)]);
    const order = await fullOrder(c.env.DB, id); if (!order) return fail("Order not found", 404); if (!order.cancelled_at) return fail("Only pending orders can be cancelled", 422);
    return json(order);
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
    return json(await fullOrder(c.env.DB, id));
});
app.delete("/api/quotations/:id", async (c) => {
    const denied = requireAdmin(c);
    if (denied) return denied;
    const id = Number(c.req.param("id"));
    const target = await c.env.DB.prepare("SELECT id FROM quotations WHERE id=? AND deleted_at IS NULL").bind(id).first<{ id: number }>();
    if (!target) return fail("Order not found", 404);
    await c.env.DB.prepare("UPDATE quotations SET deleted_at=CURRENT_TIMESTAMP WHERE id=? AND deleted_at IS NULL").bind(id).run();
    return new Response(null, { status: 204 });
});
app.all("*", c => c.env.ASSETS.fetch(c.req.raw));
export default app;
