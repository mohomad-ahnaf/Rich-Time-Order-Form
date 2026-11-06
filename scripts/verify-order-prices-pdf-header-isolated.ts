const base = process.env.TEST_BASE || "http://127.0.0.1:8790";

type Session = { cookie: string; csrf: string };

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

async function login(username: string, password: string): Promise<Session> {
  const response = await fetch(`${base}/api/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  assert(response.status === 204, `Login failed for ${username}: ${response.status}`);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  assert(cookie, "Login did not set a session cookie");
  const session = await fetch(`${base}/api/session`, { headers: { cookie } });
  assert(session.ok, "Could not read session");
  return { cookie: cookie!, csrf: (await session.json() as { csrfToken: string }).csrfToken };
}

async function request<T>(session: Session, path: string, method = "GET", body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      cookie: session.cookie,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(["GET", "HEAD"].includes(method) ? {} : { "X-CSRF-Token": session.csrf }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { response, body: await response.json().catch(() => null) as T };
}

const key = () => crypto.randomUUID();

async function main() {
  const admin = await login("test-admin", "test-password");
  const createdRep = await request<{ id: number }>(admin, "/api/accounts", "POST", { username: "pricing-rep", password: "rep-password" });
  assert(createdRep.response.status === 201, "Admin could not create test Rep");
  const buyer = await request<{ id: number }>(admin, "/api/buyers", "POST", { full_name: "PRICE TEST BUYER", phone: "DEV-PRICE-001", email: "", address: "1 Test Street\nColombo" });
  assert(buyer.response.status === 201, "Could not create test buyer");
  const product = await request<{ id: number }>(admin, "/api/products", "POST", { name: "PRICE TEST PRODUCT", price_minor: 850000 });
  assert(product.response.status === 201, "Could not create test product");
  const header = await request<{ shop_name: string; pdf_document_title: string }>(admin, "/api/settings/pdf-header", "PUT", {
    shop_name: "Test Holdings",
    address: "118 Test Street\nColombo 11",
    phone: "0770000000",
    document_title: "Purchase Order",
  });
  assert(header.response.ok && header.body.shop_name === "Test Holdings", "Admin PDF header did not persist");

  const rep = await login("pricing-rep", "rep-password");
  const deniedHeader = await request(rep, "/api/settings/pdf-header", "PUT", { shop_name: "Nope", address: "Nope", phone: "Nope", document_title: "Nope" });
  assert(deniedHeader.response.status === 403, "Rep was allowed to edit the PDF header");

  const order = (idempotencyKey: string, unitPriceMinor: number, quantity = 1) => ({
    idempotencyKey,
    buyerId: buyer.body.id,
    quotationDate: "2026-11-06",
    items: [{ productId: product.body.id, quantity, unitPriceMinor }],
  });
  const adminBelowMinimum = await request<any>(admin, "/api/quotations", "POST", order(key(), 1));
  assert(adminBelowMinimum.response.status === 201 && adminBelowMinimum.body.items[0].unit_price_minor === 1, "Admin below-minimum price was rejected");
  const invalidPrice = await request<any>(admin, "/api/quotations", "POST", order(key(), -1));
  assert(invalidPrice.response.status === 400, "Negative unit price was accepted");
  const equalKey = key();
  const equal = await request<any>(rep, "/api/quotations", "POST", order(equalKey, 850000));
  assert(equal.response.status === 201 && equal.body.items[0].unit_price_minor === 850000, "Minimum price order was not saved correctly");
  assert(equal.body.shop_name === "Test Holdings" && equal.body.pdf_document_title === "Purchase Order", "Order did not snapshot the PDF header");

  const higher = await request<any>(rep, "/api/quotations", "POST", order(key(), 900050, 2));
  assert(higher.response.status === 201 && higher.body.total_minor === 1800100 && higher.body.items[0].row_total_minor === 1800100, "Higher decimal price totals are incorrect");
  const below = await request<any>(rep, "/api/quotations", "POST", order(key(), 849999));
  assert(below.response.status === 422 && /Minimum price/.test(below.body.error), "Below-minimum Rep price was accepted");

  const updatedProduct = await request(admin, `/api/products/${product.body.id}`, "PUT", { name: "PRICE TEST PRODUCT", price_minor: 860000, active: 1 });
  assert(updatedProduct.response.ok, "Could not increase the catalog minimum");
  const retry = await request<any>(rep, "/api/quotations", "POST", order(equalKey, 850000));
  assert(retry.response.status === 200 && retry.body.id === equal.body.id && retry.body.items[0].unit_price_minor === 850000, "Idempotent retry did not return the saved snapshot");
  const stale = await request<any>(rep, "/api/quotations", "POST", order(key(), 850000));
  assert(stale.response.status === 422, "Stale price after catalog increase was accepted");

  console.log("PASS: isolated order-price, idempotency, and PDF-header API checks");
}

main().catch((error) => {
  console.error(`FAIL: ${(error as Error).message}`);
  process.exitCode = 1;
});
