import { describe, expect, it } from "vitest";
import { orderFilename, orderReference } from "./order-reference";
import type { Quotation } from "./types";

const order = (overrides: Partial<Quotation> = {}): Quotation => ({
  id: 42,
  quotation_number: "ORD-LEGACY-42",
  order_code: "0042",
  buyer_id: 1,
  quotation_date: "2026-11-05",
  total_minor: 0,
  buyer_name: "Kasun Perera",
  buyer_phone: "DEV",
  buyer_address: "25 Temple Road Colombo",
  shop_name: "RSK Holdings",
  shop_phone: "0778917678",
  shop_address: "Colombo 11",
  created_at: "2026-11-05 00:00:00",
  items: [],
  ...overrides,
});

describe("order PDF references", () => {
  it("uses the saved code, customer name, and address", () => {
    expect(orderReference(order())).toBe("0042_Kasun_Perera_25_Temple_Road_Colombo");
    expect(orderFilename(order())).toBe("0042_Kasun_Perera_25_Temple_Road_Colombo.pdf");
  });

  it("omits a missing address and preserves a legacy code", () => {
    const legacy = order({ order_code: null, quotation_number: "QT-20261105-ABCD", buyer_address: null });
    expect(orderReference(legacy)).toBe("QT-20261105-ABCD_Kasun_Perera");
  });

  it("sanitizes and bounds long filenames deterministically", () => {
    const long = order({ buyer_address: `Road <>:"/\\|?* ${"Long ".repeat(60)}` });
    const first = orderFilename(long);
    expect(first).toBe(orderFilename(long));
    expect(first).toMatch(/^0042_/);
    expect(first.endsWith(".pdf")).toBe(true);
    expect(first.length).toBeLessThanOrEqual(154);
  });
});
