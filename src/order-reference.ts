import type { Quotation } from "./types";

export const orderCode = (order: Quotation) => order.order_code || order.quotation_number;

const safePart = (value?: string | null) =>
  (value || "")
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

export const orderReference = (order: Quotation) =>
  [safePart(orderCode(order)), safePart(order.buyer_name), safePart(order.buyer_address)]
    .filter(Boolean)
    .join("_");

export const orderFilename = (order: Quotation) => {
  const code = safePart(orderCode(order)) || "order";
  const suffix = [safePart(order.buyer_name), safePart(order.buyer_address)].filter(Boolean).join("_");
  const safe = suffix ? `${code}_${suffix}` : code;
  return `${safe.slice(0, 150)}.pdf`;
};
