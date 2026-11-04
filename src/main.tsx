import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { jsPDF } from "jspdf";
import * as at from "jspdf-autotable";
import {
  FileText,
  History,
  Package,
  Users,
  LogOut,
  Eye,
  EyeOff,
  Download,
  Share2,
  Plus,
  X,
  ChevronRight,
} from "lucide-react";
import type { Buyer, Product, Quotation } from "./types";
import "./styles.css";
const table = (at as any).default,
  fmt = (n: number) =>
    new Intl.NumberFormat("en-LK", {
      style: "currency",
      currency: "LKR",
    }).format(n / 100);
const moneyNumber = (n: number) =>
  new Intl.NumberFormat("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n / 100);
let csrf = "";
const newOrderKey = () => crypto.randomUUID();
const formatOrderDateTime = (value: string) => {
  const timestamp = /(?:Z|[+-]\d\d:\d\d)$/.test(value)
    ? value
    : `${value.replace(" ", "T")}Z`;
  const date = new Date(timestamp);
  const datePart = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Colombo",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
  const timePart = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Colombo",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
  return `${datePart} · ${timePart}`;
};
async function api<T>(u: string, o: RequestInit = {}): Promise<T> {
  const r = await fetch(u, {
    ...o,
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrf,
      ...o.headers,
    },
  });
  if (!r.ok) {
    const b = await r.json().catch(() => ({}));
    throw Error((b as any).error || `Request failed (${r.status})`);
  }
  return r.status === 204 ? (undefined as T) : r.json();
}
function PDF({ q }: { q: Quotation }) {
  const [info, setInfo] = useState("");
  const run = async (action: string) => {
    const previewWindow = action === "preview" ? window.open("", "_blank") : null;
    try {
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const left = 14;
      const right = pageWidth - 14;

      pdf.setTextColor(25, 40, 55);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(15);
      pdf.text("RICH TIME", left, 17);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9);
      pdf.text(["No81, keyzer St, Colombo 11", "Phone: 0778917678"], left, 23);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(16);
      pdf.text("Purchase Order", right, 17, { align: "right" });
      pdf.setDrawColor(190, 195, 200);
      pdf.setLineWidth(0.25);
      pdf.line(left, 32, right, 32);

      let detailsY = 39;
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(10);
      pdf.text("Customer", left, detailsY);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9);
      const customer = [`Name : ${q.buyer_name}`, `Phone : ${q.buyer_phone}`];
      if (q.buyer_address?.trim()) {
        customer.push(...pdf.splitTextToSize(`Address : ${q.buyer_address}`, 108));
      }
      pdf.text(customer, left, detailsY + 5);

      pdf.setFont("helvetica", "bold");
      pdf.text("Order number", right, detailsY, { align: "right" });
      pdf.setFont("helvetica", "normal");
      pdf.text(q.quotation_number, right, detailsY + 5, { align: "right" });
      pdf.setFont("helvetica", "bold");
      pdf.text("Order date", right, detailsY + 12, { align: "right" });
      pdf.setFont("helvetica", "normal");
      pdf.text(formatOrderDateTime(q.created_at), right, detailsY + 17, { align: "right" });
      detailsY += Math.max(27, 10 + customer.length * 4.5);

      table(pdf, {
        startY: detailsY,
        margin: { top: 38, right: 14, bottom: 18, left: 14 },
        head: [["No.", "Description", "Quantity", "Unit Price (LKR)", "Amount (LKR)"]],
        body: q.items.map((item, index) => [
          String(index + 1),
          item.item_name,
          String(item.quantity),
          moneyNumber(item.unit_price_minor),
          moneyNumber(item.row_total_minor),
        ]),
        foot: [["", "", "", "Grand Total (LKR)", moneyNumber(q.total_minor)]],
        showFoot: "lastPage",
        theme: "grid",
        styles: { font: "helvetica", fontSize: 8.5, cellPadding: 2.2, textColor: [35, 42, 48], lineColor: [195, 198, 201], lineWidth: 0.15, valign: "middle" },
        headStyles: { fillColor: [245, 246, 247], textColor: [35, 42, 48], fontStyle: "bold" },
        alternateRowStyles: { fillColor: [250, 250, 250] },
        footStyles: { fillColor: [245, 246, 247], textColor: [25, 40, 55], fontStyle: "bold" },
        columnStyles: { 0: { cellWidth: 10, halign: "center" }, 1: { cellWidth: 76 }, 2: { cellWidth: 21, halign: "center" }, 3: { cellWidth: 33, halign: "right" }, 4: { cellWidth: 33, halign: "right" } },
      });
      const pages = pdf.getNumberOfPages();
      for (let page = 1; page <= pages; page += 1) {
        pdf.setPage(page);
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(8);
        pdf.setTextColor(80, 85, 90);
        pdf.text("This order is not a payment receipt.", left, pageHeight - 9);
        pdf.text(`Page ${page} of ${pages}`, right, pageHeight - 9, { align: "right" });
      }
      const blob = pdf.output("blob");
      const url = URL.createObjectURL(blob);
      const filename = `${q.quotation_number}.pdf`;
      const file = new File([blob], filename, { type: "application/pdf" });
      if (action === "preview") {
        if (previewWindow) previewWindow.location.href = url;
        else setInfo("Preview blocked. Download the PDF instead.");
      }
      if (action === "download") {
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        link.click();
      }
      if (action === "share" && navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file] });
      else if (action === "share") setInfo("Sharing unavailable. Download the PDF to attach it manually.");
    } catch (error) {
      if (previewWindow) previewWindow.close();
      setInfo((error as Error).message);
    }
  };
  return (
    <div className="pdf-actions">
      <button onClick={() => run("preview")}>
        <Eye /> Preview
      </button>
      <button onClick={() => run("download")}>
        <Download /> Download
      </button>
      <button onClick={() => run("share")}>
        <Share2 /> Share
      </button>
      {info && <p>{info}</p>}
    </div>
  );
}
function BuyerForm({
  buyer,
  complete,
  cancel,
  onDirtyChange,
}: {
  buyer: Buyer | null;
  complete: (buyer: Buyer) => void;
  cancel: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const initial = buyer || { full_name: "", phone: "", email: "", address: "" };
  const [form, setForm] = useState<any>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const initialValue = JSON.stringify(initial);
  const dirty = JSON.stringify(form) !== initialValue;
  useEffect(() => {
    onDirtyChange(dirty);
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty, onDirtyChange]);
  const cancelForm = () => {
    if (!dirty || window.confirm("Discard unsaved buyer changes?")) cancel();
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    if (!form.full_name.trim() || !form.phone.trim()) {
      setError("Name and phone are required.");
      return;
    }
    setBusy(true);
    try {
      const result = await api<Buyer>(buyer ? `/api/buyers/${buyer.id}` : "/api/buyers", {
        method: buyer ? "PUT" : "POST",
        body: JSON.stringify({ ...form, email: form.email || "", address: form.address || null, active: 1 }),
      });
      complete(buyer ? { ...buyer, ...form } : result);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="inline-form" onSubmit={save}>
      <label>Name<input required value={form.full_name} onChange={(event) => setForm({ ...form, full_name: event.target.value })} /></label>
      <label>Phone<input required inputMode="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label>
      <label>Email (optional)<input type="email" value={form.email || ""} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
      <label>Address (optional)<textarea value={form.address || ""} onChange={(event) => setForm({ ...form, address: event.target.value })} /></label>
      {error && <p className="error">{error}</p>}
      <div className="form-footer">
        <button type="button" onClick={cancelForm}>Cancel</button>
        <button className="primary" disabled={busy}>{busy ? "Saving…" : "Save buyer"}</button>
      </div>
    </form>
  );
}
function BuyerPicker({ buyers, selected, select, add }: { buyers: Buyer[]; selected: Buyer | null; select: (b: Buyer | null) => void; add: () => void }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const matches = buyers.filter(b => `${b.full_name} ${b.phone}`.toLowerCase().includes(query.toLowerCase()));
  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) window.setTimeout(() => input.current?.focus(), 0);
  };
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close(true);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return <div className="picker" ref={root}><label>Buyer<input ref={input} aria-label="Search or select buyer" placeholder="Search or select buyer" value={selected ? `${selected.full_name} · ${selected.phone}` : query} onFocus={() => { setOpen(true); if (selected) select(null); }} onChange={e => { setQuery(e.target.value); setOpen(true); }}/></label>{open && <div className="picker-popover"><button type="button" className="add-row buyer-add-row" onClick={add}><Plus aria-hidden="true" /> Add new buyer</button><div className="picker-results">{matches.map(b => <button type="button" key={b.id} onClick={() => { select(b); close(); setQuery(""); }}><strong>{b.full_name}</strong><small>{b.phone}</small></button>)}{!matches.length && <p>No buyers found</p>}</div></div>}</div>;
}
function ItemsTable({
  products,
  items,
  setItems,
  onQuantityValidityChange,
  validationAttempt,
}: {
  products: Product[];
  items: { p: Product; q: number }[];
  setItems: React.Dispatch<React.SetStateAction<{ p: Product; q: number }[]>>;
  onQuantityValidityChange: (hasInvalidQuantity: boolean) => void;
  validationAttempt: number;
}) {
  const [query, setQuery] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [quantityDrafts, setQuantityDrafts] = useState<Record<number, string>>({});
  const [touchedQuantities, setTouchedQuantities] = useState<Record<number, boolean>>({});
  const trigger = useRef<HTMLButtonElement>(null);
  const matches = products.filter((product) =>
    `${product.brand} ${product.model_name} ${product.sku}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );

  const quantityValue = (productId: number, quantity: number) => quantityDrafts[productId] ?? String(quantity);
  const validQuantity = (value: string) => /^\d+$/.test(value) && Number(value) >= 1;
  const setQuantity = (productId: number, value: string) => {
    setQuantityDrafts((drafts) => ({ ...drafts, [productId]: value }));
    if (!validQuantity(value)) return;
    const quantity = Number(value);
    setItems((current) =>
      current.map((item) =>
        item.p.id === productId ? { ...item, q: quantity } : item,
      ),
    );
  };
  const validateQuantity = (productId: number) => {
    setTouchedQuantities((touched) => ({ ...touched, [productId]: true }));
  };
  const remove = (productId: number) =>
    setItems((current) => current.filter((item) => item.p.id !== productId));
  const choose = (product: Product) => {
    setItems((current) =>
      current.some((item) => item.p.id === product.id)
        ? current.map((item) =>
            item.p.id === product.id ? { ...item, q: item.q + 1 } : item,
          )
        : [...current, { p: product, q: 1 }],
    );
    setQuery("");
    setPickerOpen(false);
  };
  const closePicker = (restoreFocus = false) => {
    setPickerOpen(false);
    if (restoreFocus) window.setTimeout(() => trigger.current?.focus(), 0);
  };
  useEffect(() => {
    if (!pickerOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closePicker(true);
    };
    window.addEventListener("keydown", escape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", escape);
    };
  }, [pickerOpen]);
  useEffect(() => {
    const invalid = items.some((item) => !validQuantity(quantityValue(item.p.id, item.q)));
    onQuantityValidityChange(invalid);
  }, [items, quantityDrafts]);
  useEffect(() => {
    if (!validationAttempt) return;
    setTouchedQuantities(Object.fromEntries(items.map((item) => [item.p.id, true])));
  }, [validationAttempt]);

  return (
    <>
      <div className="item-cards" aria-label="Order items">
        {items.map((item, index) => (
          <article className="item-card" key={item.p.id}>
            <div className="item-card-top">
              <span className="item-number">{index + 1}</span>
              <span className="item-description">
                <strong>{item.p.brand} {item.p.model_name}</strong>
                <small>{item.p.sku}</small>
              </span>
              <button type="button" className="remove-item" onClick={() => remove(item.p.id)}>
                Remove
              </button>
            </div>
            <div className="item-card-details">
              <label>
                Quantity
                <input
                  type="number"
                  min="1"
                  step="1"
                  inputMode="numeric"
                  value={quantityValue(item.p.id, item.q)}
                  onChange={(event) => setQuantity(item.p.id, event.target.value)}
                  onBlur={() => validateQuantity(item.p.id)}
                />
                {touchedQuantities[item.p.id] && !validQuantity(quantityValue(item.p.id, item.q)) && <small className="field-error">Enter a whole number of at least 1.</small>}
              </label>
              <span><small>Unit rate</small><strong>{fmt(item.p.price_minor)}</strong></span>
              <span><small>Amount</small><strong>{fmt(item.p.price_minor * item.q)}</strong></span>
            </div>
          </article>
        ))}
      </div>

      <div className="items-desktop">
        <table>
          <thead><tr><th>No.</th><th>Description</th><th>Quantity</th><th>Unit Rate</th><th>Amount</th><th>Remove</th></tr></thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={item.p.id}>
                <td>{index + 1}</td>
                <td>{item.p.brand} {item.p.model_name}<small>{item.p.sku}</small></td>
                <td><input type="number" min="1" step="1" value={quantityValue(item.p.id, item.q)} onChange={(event) => setQuantity(item.p.id, event.target.value)} onBlur={() => validateQuantity(item.p.id)} /></td>
                <td>{fmt(item.p.price_minor)}</td>
                <td>{fmt(item.p.price_minor * item.q)}</td>
                <td><button type="button" className="remove-item" onClick={() => remove(item.p.id)}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button ref={trigger} type="button" className="add-row" onClick={() => setPickerOpen(true)}>
        <Plus aria-hidden="true" /> Add item
      </button>

      {pickerOpen && (
        <div className="product-sheet-backdrop" onClick={() => closePicker(true)}>
          <section
            className="product-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Add a product"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "Escape") closePicker(true);
            }}
          >
            <div className="product-sheet-heading">
              <h2>Add item</h2>
              <button type="button" onClick={() => closePicker(true)}>Cancel</button>
            </div>
            <label>
              Search products
              <input
                autoFocus
                placeholder="Brand, model, or SKU"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <div className="product-results" aria-live="polite">
              {matches.map((product) => (
                <button type="button" key={product.id} onClick={() => choose(product)}>
                  <strong>{product.brand} {product.model_name}</strong>
                  <small>{product.sku} · {fmt(product.price_minor)}</small>
                </button>
              ))}
              {!matches.length && <p>No products found</p>}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
function App() {
  const [ok, setOk] = useState(false),
    [page, setPage] = useState("quote"),
    [bs, setBs] = useState<Buyer[]>([]),
    [ps, setPs] = useState<Product[]>([]),
    [b, setB] = useState<Buyer | null>(null),
    [its, setIts] = useState<{ p: Product; q: number }[]>([]),
    [saved, setSaved] = useState<Quotation | null>(null),
    [savedMode, setSavedMode] = useState<"success" | "detail" | null>(null),
    [history, setHistory] = useState<any[]>([]),
    [historyQuery, setHistoryQuery] = useState(""),
    [historyLoading, setHistoryLoading] = useState(false),
    [historyError, setHistoryError] = useState(""),
    [buyerQuery, setBuyerQuery] = useState(""),
    [buyerResults, setBuyerResults] = useState<Buyer[]>([]),
    [buyerLoading, setBuyerLoading] = useState(false),
    [buyerError, setBuyerError] = useState(""),
    [productQuery, setProductQuery] = useState(""),
    [productResults, setProductResults] = useState<Product[]>([]),
    [productLoading, setProductLoading] = useState(false),
    [productError, setProductError] = useState(""),
    [err, setErr] = useState(""),
    [saving, setSaving] = useState(false),
    [quantityInvalid, setQuantityInvalid] = useState(false),
    [quantityValidationAttempt, setQuantityValidationAttempt] = useState(0),
    [orderKey, setOrderKey] = useState(newOrderKey),
    [formResetKey, setFormResetKey] = useState(0),
    [buyerFormDirty, setBuyerFormDirty] = useState(false),
    [buyerForm, setBuyerForm] = useState<Buyer | null | undefined>(undefined);
  const dialogTrigger = useRef<HTMLElement | null>(null);
  const lastFocusedField = useRef<HTMLElement | null>(null);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const refreshBuyers = () => api<Buyer[]>("/api/buyers").then((buyers) => {
    setBs(buyers);
    if (!buyerQuery) setBuyerResults(buyers);
    return buyers;
  });
  useEffect(() => {
    api<any>("/api/session")
      .then((s) => {
        csrf = s.csrfToken;
        setOk(true);
        return Promise.all([
          api<Buyer[]>("/api/buyers"),
          api<Product[]>("/api/products"),
        ]);
      })
      .then(([x, y]) => {
        setBs(x);
        setPs(y);
      })
      .catch(() => setOk(false));
  }, []);
  useEffect(() => {
    if (!ok) return;
    let stale = false;
    setHistoryLoading(true);
    setHistoryError("");
    const timer = window.setTimeout(() => {
      api<any[]>(`/api/quotations?q=${encodeURIComponent(historyQuery)}`)
        .then((orders) => {
          if (!stale) setHistory(orders);
        })
        .catch((error) => {
          if (!stale) setHistoryError((error as Error).message);
        })
        .finally(() => {
          if (!stale) setHistoryLoading(false);
        });
    }, 250);
    return () => {
      stale = true;
      window.clearTimeout(timer);
    };
  }, [ok, historyQuery]);
  useEffect(() => {
    if (!ok) return;
    let stale = false;
    setBuyerLoading(true);
    setBuyerError("");
    const timer = window.setTimeout(() => {
      api<Buyer[]>(`/api/buyers?q=${encodeURIComponent(buyerQuery)}`)
        .then((buyers) => { if (!stale) setBuyerResults(buyers); })
        .catch((error) => { if (!stale) setBuyerError((error as Error).message); })
        .finally(() => { if (!stale) setBuyerLoading(false); });
    }, 250);
    return () => { stale = true; window.clearTimeout(timer); };
  }, [ok, buyerQuery]);
  useEffect(() => {
    if (!ok) return;
    let stale = false;
    setProductLoading(true);
    setProductError("");
    const timer = window.setTimeout(() => {
      api<Product[]>(`/api/products?q=${encodeURIComponent(productQuery)}`)
        .then((products) => { if (!stale) setProductResults(products); })
        .catch((error) => { if (!stale) setProductError((error as Error).message); })
        .finally(() => { if (!stale) setProductLoading(false); });
    }, 250);
    return () => { stale = true; window.clearTimeout(timer); };
  }, [ok, productQuery]);
  const resetNewOrder = () => {
    setB(null);
    setIts([]);
    setErr("");
    setQuantityInvalid(false);
    setBuyerForm(undefined);
    setOrderKey(newOrderKey());
    setFormResetKey((key) => key + 1);
    setPage("quote");
  };
  const closeSavedOrder = () => {
    const resetForm = savedMode === "success";
    setSaved(null);
    setSavedMode(null);
    if (resetForm) resetNewOrder();
    window.setTimeout(() => dialogTrigger.current?.focus(), 0);
  };
  useEffect(() => {
    if (!saved) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeSavedOrder();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [saved]);
  useEffect(() => {
    const viewport = window.visualViewport;
    const viewportHeight = () => viewport?.height || window.innerHeight;
    let largestHeight = viewportHeight();
    const update = () => {
      const focused = document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement ||
        document.activeElement instanceof HTMLSelectElement;
      if (!focused) largestHeight = Math.max(largestHeight, viewportHeight());
      const heightLoss = largestHeight - viewportHeight();
      setKeyboardOpen(focused && heightLoss > 150 && heightLoss / largestHeight > 0.2);
    };
    const orientationChange = () => {
      largestHeight = viewportHeight();
      setKeyboardOpen(false);
    };
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", orientationChange);
    return () => {
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", orientationChange);
    };
  }, []);
  useEffect(() => {
    const keepVisible = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || target === lastFocusedField.current) return;
      if (!target.matches("input, textarea, select")) return;
      lastFocusedField.current = target;
      window.setTimeout(() => target.scrollIntoView({ block: "nearest", behavior: "smooth" }), 150);
    };
    document.addEventListener("focusin", keepVisible);
    return () => document.removeEventListener("focusin", keepVisible);
  }, []);
  if (!ok) return <Login />;
  const total = its.reduce((n, i) => n + i.p.price_minor * i.q, 0);
  const save = async () => {
    if (saving) return;
    if (quantityInvalid) {
      setErr("Correct the invalid item quantities before saving.");
      setQuantityValidationAttempt((attempt) => attempt + 1);
      return;
    }
    if (!b || !its.length)
      return setErr("Choose a buyer and at least one product.");
    setErr("");
    setSaving(true);
    try {
      const q = await api<Quotation>("/api/quotations", {
        method: "POST",
        body: JSON.stringify({
          idempotencyKey: orderKey,
          buyerId: b.id,
          quotationDate: new Date().toISOString().slice(0, 10),
          items: its.map((i) => ({ productId: i.p.id, quantity: i.q })),
        }),
      });
      setSaved(q);
      setSavedMode("success");
      setHistory((current) => [q, ...current]);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const openOrder = (id: number, trigger: HTMLElement) => {
    dialogTrigger.current = trigger;
    api<Quotation>(`/api/quotations/${id}`)
      .then((order) => {
        setSaved(order);
        setSavedMode("detail");
      })
      .catch((error) => setHistoryError((error as Error).message));
  };
  const navigate = (nextPage: string) => {
    if (buyerFormDirty && !window.confirm("Discard unsaved buyer changes?")) return;
    setBuyerFormDirty(false);
    if (buyerForm !== undefined) setBuyerForm(undefined);
    setPage(nextPage);
  };
  return (
    <div className={`app-shell${keyboardOpen ? " keyboard-open" : ""}`}>
      <header className="topbar">
        <b>RICH TIME</b>
        <button
          onClick={() =>
            (!buyerFormDirty || window.confirm("Discard unsaved buyer changes and log out?")) &&
            api("/api/logout", { method: "POST" }).then(() => location.reload())
          }
          className="header-action"
          aria-label="Log out">
          <LogOut />
        </button>
      </header>
      <main className="app-main">
        {page === "quote" && (
          <section className="quote-page">
            <h1>New Order</h1>
            <BuyerPicker
              key={`buyer-${formResetKey}`}
              buyers={bs}
              selected={b}
              select={setB}
              add={() => {
                setBuyerForm(null);
                setPage("buyers");
              }}
            />
            <h2>Items</h2>
            <ItemsTable key={`items-${formResetKey}`} products={ps} items={its} setItems={setIts} onQuantityValidityChange={setQuantityInvalid} validationAttempt={quantityValidationAttempt} />
            <div className="quote-total">
              <span>Total</span>
              <strong>{fmt(total)}</strong>
              <button className="primary" onClick={(event) => { dialogTrigger.current = event.currentTarget; save(); }} disabled={saving}>
                {saving ? "Saving…" : "Review & Save"}
              </button>
            </div>
            {err && <p className="error">{err}</p>}
          </section>
        )}
        {page === "history" && (
          <section className="list-page">
            <h1>Orders</h1>
            <label className="history-search">
              Search by buyer name or phone
              <div>
                <input
                  type="search"
                  placeholder="Buyer name, phone, or order number"
                  value={historyQuery}
                  onChange={(event) => setHistoryQuery(event.target.value)}
                />
                {historyQuery && <button type="button" onClick={() => setHistoryQuery("")}>Clear search</button>}
              </div>
            </label>
            {historyLoading && <p>Loading orders…</p>}
            {historyError && <p className="error">{historyError}</p>}
            {!historyLoading && !historyError && !history.length && <p>No orders found.</p>}
            {history.map((h) => (
              <button type="button" className="history-card order-history-card" key={h.id} onClick={(event) => openOrder(h.id, event.currentTarget)}>
                <span>
                  <strong>{h.buyer_name}</strong>
                  <small>{formatOrderDateTime(h.created_at)}</small>
                </span>
                <b>{fmt(h.total_minor)}</b>
                <ChevronRight aria-hidden="true" />
                <span className="sr-only">Open order</span>
              </button>
            ))}
          </section>
        )}
        {page === "products" && (
          <section className="list-page">
            <h1>Products</h1>
            <label className="history-search">
              Search products
              <div>
                <input type="search" placeholder="Brand, model, or SKU" value={productQuery} onChange={(event) => setProductQuery(event.target.value)} />
                {productQuery && <button type="button" onClick={() => setProductQuery("")}>Clear search</button>}
              </div>
            </label>
            {productLoading && <p>Loading products…</p>}
            {productError && <p className="error">{productError}</p>}
            {!productLoading && !productError && !productResults.length && <p>No products found.</p>}
            {productResults.map((p) => (
              <article className="history-card" key={p.id}>
                <span>{p.brand} {p.model_name}<small>{p.sku}</small></span>
                <b>{fmt(p.price_minor)}</b>
              </article>
            ))}
          </section>
        )}
        {page === "buyers" && (
          <section className="list-page">
            <div className="section-heading"><h1>Buyers</h1><button type="button" className="add-row" onClick={() => setBuyerForm(null)}><Plus aria-hidden="true" /> Add buyer</button></div>
            {buyerForm !== undefined && <BuyerForm buyer={buyerForm} onDirtyChange={setBuyerFormDirty} cancel={() => { setBuyerFormDirty(false); setBuyerForm(undefined); }} complete={async buyer => { await refreshBuyers(); setBuyerFormDirty(false); setBuyerForm(undefined); setB(buyer); setPage("quote"); }} />}
            {buyerForm === undefined && <label className="history-search">
              Search buyers
              <div>
                <input type="search" placeholder="Buyer name or phone" value={buyerQuery} onChange={(event) => setBuyerQuery(event.target.value)} />
                {buyerQuery && <button type="button" onClick={() => setBuyerQuery("")}>Clear search</button>}
              </div>
            </label>}
            {buyerLoading && <p>Loading buyers…</p>}
            {buyerError && <p className="error">{buyerError}</p>}
            {!buyerLoading && !buyerError && !buyerResults.length && <p>No buyers found.</p>}
            {buyerForm === undefined && buyerResults.map((x) => (
              <article className="history-card" key={x.id}>
                <span>{x.full_name}<small>{x.phone}</small></span>
                <button onClick={() => setBuyerForm(x)}>Edit</button>
              </article>
            ))}
          </section>
        )}
        {saved && (
          <div className="modal-backdrop" onClick={closeSavedOrder}>
            <section className="quote-dialog" role="dialog" aria-modal="true" aria-label="Saved order" onClick={(event) => event.stopPropagation()}>
              <button type="button" className="dialog-close" onClick={closeSavedOrder} aria-label="Close">
                <X aria-hidden="true" />
              </button>
              <h1>{saved.quotation_number}</h1>
              <p>
                {saved.buyer_name} · {fmt(saved.total_minor)}
              </p>
              <PDF q={saved} />
            </section>
          </div>
        )}
      </main>
      <nav className="bottom-nav">
        {[
          ["quote", "New Order", FileText],
          ["history", "Orders", History],
          ["products", "Products", Package],
          ["buyers", "Buyers", Users],
        ].map(([id, l, I]: any) => (
          <button
            className={page === id ? "active" : ""}
            onClick={() => navigate(id)}
            key={id}
          >
            <I />
            <span>{l}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
function Login() {
  const [u, setU] = useState(""),
    [p, setP] = useState(""),
    [e, setE] = useState(""),
    [showPassword, setShowPassword] = useState(false),
    [loading, setLoading] = useState(false);
  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-brand">
          <svg viewBox="0 0 120 76" role="img" aria-label="Analog watch illustration">
            <circle cx="60" cy="38" r="27" fill="#edf6ff" stroke="#f58220" strokeWidth="4" />
            <path d="M50 8h20M50 68h20" stroke="#092f64" strokeWidth="7" strokeLinecap="round" />
            <circle cx="60" cy="38" r="3" fill="#092f64" />
            <path d="M60 38V21M60 38l13 8" stroke="#092f64" strokeWidth="3" strokeLinecap="round" />
            <circle cx="24" cy="17" r="4" fill="#f58220" opacity=".7" />
            <circle cx="99" cy="54" r="5" fill="#d9eefe" />
          </svg>
          <div><h1>Rich Time</h1><p>Sign in to manage orders.</p></div>
        </div>
        <form
          onSubmit={async (x) => {
            x.preventDefault();
            setE("");
            setLoading(true);
            try {
              await api("/api/login", {
                method: "POST",
                body: JSON.stringify({ username: u, password: p }),
              });
              location.reload();
            } catch (x) {
              setE((x as Error).message);
            } finally {
              setLoading(false);
            }
          }}
        >
          <label htmlFor="login-username">Username
          <input id="login-username"
            autoComplete="username"
            value={u}
            onChange={(x) => setU(x.target.value)}
          /></label>
          <label htmlFor="login-password">Password
          <span className="password-field"><input id="login-password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            value={p}
            onChange={(x) => setP(x.target.value)}
          /><button type="button" onClick={() => setShowPassword((shown) => !shown)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff /> : <Eye />}</button></span></label>
          <button className="primary full" disabled={loading}>{loading ? "Signing in…" : "Sign in"}</button>
          {e && <p className="error">{e}</p>}
        </form>
      </section>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
