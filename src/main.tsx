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
  Pencil,
  Trash2,
  Settings as SettingsIcon,
  BriefcaseBusiness,
  MapPin,
  CheckCircle2,
  Circle,
  Bell,
  CheckCheck,
  Gauge,
} from "lucide-react";
import type { Buyer, Product, Quotation, Settings } from "./types";
import { orderFilename, orderReference } from "./order-reference";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import "./styles.css";
const table = (at as any).default,
  fmt = (n: number) =>
    new Intl.NumberFormat("en-LK", {
      style: "currency",
      currency: "LKR",
    }).format(n / 100);
const moneyNumber = (n: number) =>
  new Intl.NumberFormat("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n / 100);
const productName = (product: Pick<Product, "brand" | "model_name">) =>
  [product.brand, product.model_name].filter(Boolean).join(" ");
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
  let r: Response;
  try {
    r = await fetch(u, {
      ...o,
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrf,
        ...o.headers,
      },
    });
  } catch {
    throw Error("Connection unavailable. Your draft is still available; reconnect and retry saving.");
  }
  if (!r.ok) {
    const b = await r.json().catch(() => ({}));
    throw Error((b as any).error || `Request failed (${r.status})`);
  }
  return r.status === 204 ? (undefined as T) : r.json();
}
type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
type JobItem = { id: number; buyer_id: number | null; buyer_name: string; buyer_address: string; visited_at: string | null; visited_by_username: string | null; version: number };
type Job = { id: number; title: string; location_query: string; instructions?: string | null; due_date?: string | null; assigned_rep_user_id: number | null; assigned_rep_username: string; status: "ACTIVE" | "COMPLETED" | "CANCELLED"; response_status: "AWAITING_RESPONSE" | "ACCEPTED" | "REJECTED"; responded_at?: string | null; responded_by_username?: string | null; rejection_reason?: string | null; version: number; cancelled_at?: string | null; cancellation_reason?: string | null; created_at: string; visited_count?: number; item_count?: number; progress?: { visited: number; total: number }; items?: JobItem[] };
function OrderDocumentPreview({ q, header }: { q: Quotation; header?: Settings | null }) {
  const headerName = q.shop_name?.trim() || header?.shop_name || "RSK Holdings";
  const headerAddress = q.shop_address?.trim() || header?.address || "";
  const headerPhone = q.shop_phone?.trim() || header?.phone || "";
  const documentTitle = q.pdf_document_title?.trim() || header?.pdf_document_title || "Purchase Order";
  const addressLines = headerAddress.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  return <article className="html-order-preview" aria-label="Draft order document">
    <header className="html-order-header">
      <div><strong>{headerName}</strong>{addressLines.map((line, index) => <span key={index}>{line}</span>)}{headerPhone && <span>Phone: {headerPhone}</span>}</div>
      <h2>{documentTitle}</h2>
    </header>
    <div className="html-order-rule" />
    <section className="html-order-details">
      <div><strong>Customer</strong><span>Name : {q.buyer_name}</span>{q.buyer_address?.trim() && <span className="preserve-lines">Address : {q.buyer_address}</span>}</div>
      <div className="html-order-reference"><strong>Order number</strong><span>Draft — order number assigned on confirmation</span><strong>Order date</strong><span>{formatOrderDateTime(q.created_at)}</span></div>
    </section>
    <div className="html-order-table-wrap">
      <table className="html-order-table">
        <thead><tr><th>No.</th><th>Description</th><th>Quantity</th><th>Unit Price (LKR)</th><th>Amount (LKR)</th></tr></thead>
        <tbody>{q.items.map((item, index) => <tr key={`${item.product_id}-${index}`}><td>{index + 1}</td><td>{item.item_name}</td><td>{item.quantity}</td><td>{moneyNumber(item.unit_price_minor)}</td><td>{moneyNumber(item.row_total_minor)}</td></tr>)}</tbody>
        <tfoot><tr><td colSpan={3} /><th>Grand Total (LKR)</th><td>{moneyNumber(q.total_minor)}</td></tr></tfoot>
      </table>
    </div>
    <footer>This order is not a payment receipt.</footer>
  </article>;
}
/* Removed PDF.js canvas renderer. Draft previews use responsive HTML instead.
function PdfCanvasViewer({ url }: { url: string }) {
  const viewport = useRef<HTMLDivElement>(null);
  const documentRef = useRef<any>(null);
  const touchPoints = useRef(new Map<number, { x: number; y: number }>());
  const pinchDistance = useRef<number | null>(null);
  const [fitScale, setFitScale] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [renderZoom, setRenderZoom] = useState(1);
  const [pages, setPages] = useState<{ cssWidth: number; cssHeight: number; pixels: ImageData }[]>([]);
  const [error, setError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const selectedScale = fitScale * renderZoom;
  useEffect(() => {
    const timer = window.setTimeout(() => setRenderZoom(zoom), 140);
    return () => window.clearTimeout(timer);
  }, [zoom]);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const resize = () => {
      const width = Math.max(1, element.clientWidth - 20);
      const pageWidth = 595.28;
      setFitScale(width / pageWidth);
      setZoom(1);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let cancelled = false;
    let renderTask: any;
    let loadingTask: any;
    let pdfDocument: any;
    const render = async () => {
      setError("");
      setPages([]);
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        loadingTask = pdfjs.getDocument({ url });
        const pdf = await loadingTask.promise;
        pdfDocument = pdf;
        documentRef.current = pdf;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const rendered: { cssWidth: number; cssHeight: number; pixels: ImageData }[] = [];
        for (let index = 0; index < pdf.numPages; index += 1) {
          if (cancelled) return;
          const page = await pdf.getPage(index + 1);
          const cssViewport = page.getViewport({ scale: selectedScale });
          const baseViewport = page.getViewport({ scale: 1 });
          const maxScaleForMemory = Math.sqrt(4_000_000 / (baseViewport.width * baseViewport.height));
          const renderScale = Math.min(selectedScale * dpr, 3, maxScaleForMemory);
          const renderViewport = page.getViewport({ scale: renderScale });
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(renderViewport.width);
          canvas.height = Math.ceil(renderViewport.height);
          const context = canvas.getContext("2d", { alpha: false });
          if (!context) throw Error("PDF canvas is unavailable.");
          renderTask = page.render({ canvas, canvasContext: context, viewport: renderViewport });
          await renderTask.promise;
          if (cancelled) return;
          rendered.push({ cssWidth: cssViewport.width, cssHeight: cssViewport.height, pixels: context.getImageData(0, 0, canvas.width, canvas.height) });
          setPages([...rendered]);
          if (index === 0) await new Promise((resolve) => window.setTimeout(resolve, 0));
        }
      } catch (reason) {
        if (!cancelled) setError((reason as Error).message || "Could not render this PDF.");
      }
    };
    if (url && selectedScale > 0) void render();
    return () => {
      cancelled = true;
      renderTask?.cancel?.();
      loadingTask?.destroy?.();
      pdfDocument?.destroy?.();
    };
  }, [url, selectedScale, retryKey]);
  const drawCanvas = (node: HTMLCanvasElement | null, page: { cssWidth: number; cssHeight: number; pixels: ImageData }) => {
    if (!node) return;
    node.width = page.pixels.width;
    node.height = page.pixels.height;
    node.style.width = `${page.cssWidth}px`;
    node.style.height = `${page.cssHeight}px`;
    node.getContext("2d")?.putImageData(page.pixels, 0, 0);
  };
  const pointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    touchPoints.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture(event.pointerId);
    if (touchPoints.current.size === 2) {
      const [a, b] = [...touchPoints.current.values()];
      pinchDistance.current = Math.hypot(a.x - b.x, a.y - b.y);
    }
  };
  const pointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const previousPoint = touchPoints.current.get(event.pointerId);
    if (!previousPoint) return;
    touchPoints.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (touchPoints.current.size === 1) {
      event.preventDefault();
      event.currentTarget.scrollLeft -= event.clientX - previousPoint.x;
      event.currentTarget.scrollTop -= event.clientY - previousPoint.y;
      return;
    }
    if (touchPoints.current.size !== 2 || !pinchDistance.current) return;
    event.preventDefault();
    const [a, b] = [...touchPoints.current.values()];
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    setZoom((current) => Math.max(0.5, Math.min(3, current * (pinchDistance.current! / distance))));
    pinchDistance.current = distance;
  };
  const pointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    touchPoints.current.delete(event.pointerId);
    if (touchPoints.current.size < 2) pinchDistance.current = null;
  };
  return <div className="pdf-canvas-shell">
    <div className="pdf-viewer-controls" aria-label="PDF zoom controls"><button type="button" onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))} aria-label="Zoom out">−</button><button type="button" onClick={() => setZoom(1)}>Fit page</button><button type="button" onClick={() => setZoom((value) => Math.min(3, value + 0.25))} aria-label="Zoom in">+</button></div>
    <div className="pdf-page-scroll" ref={viewport} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd}>
      {error && <div className="pdf-viewer-error"><p className="error">{error}</p><button type="button" onClick={() => setRetryKey((key) => key + 1)}>Retry</button></div>}
      {!error && !pages.length && <p>Rendering PDF…</p>}
      <div className="pdf-pages" style={{ zoom: zoom / renderZoom }}>{pages.map((page, index) => <canvas key={index} ref={(node) => drawCanvas(node, page)} aria-label={`PDF page ${index + 1}`} />)}</div>
    </div>
  </div>;
}
*/
function PwaControls() {
  const [deferred, setDeferred] = useState<InstallPromptEvent | null>(null);
  const [showIosHelp, setShowIosHelp] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  useEffect(() => {
    if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
    const onInstallPrompt = (event: Event) => { event.preventDefault(); setDeferred(event as InstallPromptEvent); };
    window.addEventListener("beforeinstallprompt", onInstallPrompt);
    navigator.serviceWorker.register("/sw.js").then((registration) => {
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        worker?.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) setUpdateAvailable(true);
        });
      });
    }).catch(() => undefined);
    return () => window.removeEventListener("beforeinstallprompt", onInstallPrompt);
  }, []);
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(navigator as Navigator & { standalone?: boolean }).standalone;
  if (!deferred && !isIos && !updateAvailable) return null;
  return <aside className="pwa-controls" aria-live="polite">
    {deferred && <button type="button" onClick={async () => { await deferred.prompt(); setDeferred(null); }}><Download aria-hidden="true" /> Install app</button>}
    {isIos && <button type="button" onClick={() => setShowIosHelp((open) => !open)}><Download aria-hidden="true" /> Install app</button>}
    {showIosHelp && <p>In Safari, tap Share, then choose Add to Home Screen. Installation requires HTTPS on a phone.</p>}
    {updateAvailable && <button type="button" className="primary" onClick={() => location.reload()}>Update available — reload</button>}
  </aside>;
}
function PwaUpdateNotice() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  useEffect(() => {
    if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").then((registration) => {
      const check = () => { if (registration.waiting) setUpdateAvailable(true); };
      check();
      registration.addEventListener("updatefound", () => registration.installing?.addEventListener("statechange", () => { if (registration.installing?.state === "installed" && navigator.serviceWorker.controller) setUpdateAvailable(true); }));
    }).catch(() => undefined);
  }, []);
  if (!updateAvailable) return null;
  return <aside className="pwa-controls" aria-live="polite"><button type="button" className="primary" onClick={async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    if (registration?.waiting) {
      navigator.serviceWorker.addEventListener("controllerchange", () => location.reload(), { once: true });
      registration.waiting.postMessage({ type: "SKIP_WAITING" });
    } else location.reload();
  }}>Update available — reload</button></aside>;
}
function PDF({ q, header, onUnavailable, skipRevalidation = false }: { q: Quotation; header?: Settings | null; onUnavailable?: () => void; skipRevalidation?: boolean }) {
  const [info, setInfo] = useState("");
  const run = async (action: string) => {
    const previewWindow = action === "preview" ? window.open("", "_blank") : null;
    try {
      if (!skipRevalidation) await api<Quotation>(`/api/quotations/${q.id}`);
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const left = 14;
      const right = pageWidth - 14;

      const headerName = q.shop_name?.trim() || header?.shop_name || "RSK Holdings";
      const headerAddress = q.shop_address?.trim() || header?.address || "";
      const headerPhone = q.shop_phone?.trim() || header?.phone || "";
      const documentTitle = q.pdf_document_title?.trim() || header?.pdf_document_title || "Purchase Order";
      const headerLines = [...headerAddress.split(/\r?\n/).map((line) => line.trim()).filter(Boolean), headerPhone ? `Phone: ${headerPhone}` : ""];

      pdf.setTextColor(25, 40, 55);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(15);
      pdf.text(headerName, left, 17);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9);
      if (headerLines.length) pdf.text(headerLines, left, 23);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(16);
      pdf.text(pdf.splitTextToSize(documentTitle, 68), right, 17, { align: "right" });
      pdf.setDrawColor(190, 195, 200);
      pdf.setLineWidth(0.25);
      const dividerY = Math.max(31, 25 + headerLines.length * 4.5);
      pdf.line(left, dividerY, right, dividerY);

      let detailsY = dividerY + 7;
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(10);
      pdf.text("Customer", left, detailsY);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9);
      const customer = [`Name : ${q.buyer_name}`];
      if (q.buyer_address?.trim()) {
        customer.push(...pdf.splitTextToSize(`Address : ${q.buyer_address}`, 108));
      }
      pdf.text(customer, left, detailsY + 5);

      pdf.setFont("helvetica", "bold");
      pdf.text("Order number", right, detailsY, { align: "right" });
      pdf.setFont("helvetica", "normal");
      const referenceLines = pdf.splitTextToSize(orderReference(q), 72);
      pdf.text(referenceLines, right, detailsY + 5, { align: "right" });
      pdf.setFont("helvetica", "bold");
      const orderDateY = detailsY + 10 + referenceLines.length * 4.5;
      pdf.text("Order date", right, orderDateY, { align: "right" });
      pdf.setFont("helvetica", "normal");
      pdf.text(formatOrderDateTime(q.created_at), right, orderDateY + 5, { align: "right" });
      detailsY += Math.max(27, 10 + customer.length * 4.5, 15 + referenceLines.length * 4.5);

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
      const filename = orderFilename(q);
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
      if (/order not found|no longer available/i.test((error as Error).message)) onUnavailable?.();
    }
  };
  return (
    <div className="pdf-actions">
      <button className="pdf-icon-action" onClick={() => run("preview")} aria-label="Preview PDF" title="Preview PDF">
        <Eye aria-hidden="true" />
      </button>
      <button className="pdf-icon-action" onClick={() => run("download")} aria-label="Download PDF" title="Download PDF">
        <Download aria-hidden="true" />
      </button>
      <button className="pdf-icon-action" onClick={() => run("share")} aria-label="Share PDF" title="Share PDF">
        <Share2 aria-hidden="true" />
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
    if (!form.full_name.trim() || !form.address.trim()) {
      setError("Name and address are required.");
      return;
    }
    setBusy(true);
    try {
      const result = await api<Buyer>(buyer ? `/api/buyers/${buyer.id}` : "/api/buyers", {
        method: buyer ? "PUT" : "POST",
        body: JSON.stringify({ ...form, email: form.email || "", address: form.address, active: 1 }),
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
      <label>Phone (optional)<input inputMode="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label>
      <label>Email (optional)<input type="email" value={form.email || ""} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
      <label>Address<textarea required value={form.address || ""} onChange={(event) => setForm({ ...form, address: event.target.value })} /></label>
      {error && <p className="error">{error}</p>}
      <div className="form-footer">
        <button type="button" onClick={cancelForm}>Cancel</button>
        <button className="primary" disabled={busy}>{busy ? "Saving…" : "Save buyer"}</button>
      </div>
    </form>
  );
}
function ProductForm({ product, complete, cancel }: { product: Product | null; complete: (product: Product) => void; cancel: () => void }) {
  const [form, setForm] = useState({
    name: product ? productName(product) : "",
    price: product ? String(product.price_minor / 100) : "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const price = Number(form.price);
    if (!form.name.trim() || !Number.isFinite(price) || price < 0) {
      setError("Item name and a valid selling price are required.");
      return;
    }
    setBusy(true); setError("");
    const payload = { ...form, price_minor: Math.round(price * 100), active: product?.active ?? 1 };
    try {
      const result = await api<Product>(product ? `/api/products/${product.id}` : "/api/products", { method: product ? "PUT" : "POST", body: JSON.stringify(payload) });
      complete(product ? { ...product, brand: form.name.trim(), model_name: "", price_minor: payload.price_minor, active: payload.active } : result);
    } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); }
  };
  return <form className="inline-form" onSubmit={save}>
    <label>Item name<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
    <label>Selling price (LKR)<input required type="number" min="0" step="0.01" inputMode="decimal" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} /></label>
    {error && <p className="error">{error}</p>}
    <div className="form-footer"><button type="button" onClick={cancel}>Cancel</button><button className="primary" disabled={busy}>{busy ? "Saving…" : "Save product"}</button></div>
  </form>;
}
const withTimeout = <T,>(promise: Promise<T>, label: string, ms = 12000) => Promise.race<T>([promise, new Promise<T>((_, reject) => window.setTimeout(() => reject(Error(`${label} timed out. Check the HTTPS tunnel and try again.`)), ms))]);
async function readyServiceWorker(stage: (message: string) => void) {
  stage("Checking the service worker…");
  const response = await withTimeout(fetch("/sw.js", { cache: "no-store" }), "Service-worker check");
  if (!response.ok || !/javascript/i.test(response.headers.get("content-type") || "")) throw Error("The tunnel did not serve /sw.js as JavaScript. Check the tunnel route.");
  stage("Registering the service worker…");
  const registration = await withTimeout(navigator.serviceWorker.register("/sw.js", { scope: "/" }), "Service-worker registration");
  stage("Activating the service worker…");
  await withTimeout(navigator.serviceWorker.ready, "Service-worker activation");
  return registration;
}
function PhoneNotificationControls() {
  const [status, setStatus] = useState<"loading" | "enabled" | "disabled" | "unsupported" | "denied" | "unavailable">("loading");
  const [message, setMessage] = useState(""); const [stage, setStage] = useState("");
  const [busy, setBusy] = useState(false);
  const supported = typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const update = async () => {
    if (!supported) { setStatus("unsupported"); return; }
    if (!window.isSecureContext && location.hostname !== "localhost") { setStatus("unavailable"); return; }
    if (Notification.permission === "denied") { setStatus("denied"); return; }
    try { const registration = await readyServiceWorker(setStage); setStatus(await registration.pushManager.getSubscription() ? "enabled" : "disabled"); }
    finally { setStage(""); }
  };
  useEffect(() => { void update().catch(() => setStatus("unavailable")); }, []);
  const enable = async () => {
    setBusy(true); setMessage(""); setStage("");
    try {
      if (!supported) { setStatus("unsupported"); return; }
      if (!window.isSecureContext && location.hostname !== "localhost") { setStatus("unavailable"); return; }
      setStage("Waiting for notification permission…");
      const permission = await withTimeout(Notification.requestPermission(), "Notification permission", 15000);
      if (permission !== "granted") { setStatus("denied"); return; }
      setStage("Loading phone-notification settings…");
      const key = await withTimeout(api<{ publicKey: string }>("/api/push/public-key"), "VAPID key request");
      const bytes = Uint8Array.from(atob(key.publicKey.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0));
      const registration = await readyServiceWorker(setStage);
      setStage("Creating this device subscription…");
      const subscription = await withTimeout(registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes }), "Phone subscription", 15000);
      setStage("Saving this device securely…");
      await withTimeout(api("/api/push/subscriptions", { method: "POST", body: JSON.stringify(subscription.toJSON()) }), "Subscription save");
      setStatus("enabled"); setMessage("Phone notifications are enabled for this device.");
    } catch (error) { setStatus("disabled"); setMessage((error as Error).message || "Phone notifications could not be enabled."); }
    finally { setStage(""); setBusy(false); }
  };
  const disable = async () => {
    setBusy(true); setMessage("");
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) { await api("/api/push/subscriptions", { method: "DELETE", body: JSON.stringify({ endpoint: subscription.endpoint }) }); await subscription.unsubscribe(); }
      setStatus("disabled"); setMessage("Phone notifications are disabled for this device only.");
    } catch (error) { setMessage((error as Error).message || "Phone notifications could not be disabled."); }
    finally { setBusy(false); }
  };
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent); const installed = Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  return <section className="phone-notification-controls" aria-live="polite"><h2>Phone notifications</h2>{ios && !installed && <p>On iPhone, use Safari Share → Add to Home Screen, then open the installed app to enable notifications.</p>}{status === "loading" && <p>Checking this device…</p>}{status === "unsupported" && <p>Your browser does not support phone notifications.</p>}{status === "unavailable" && <p>Phone notifications require HTTPS (or localhost during development).</p>}{status === "denied" && <p>Notifications are blocked. Allow them in this browser’s site settings to enable this device.</p>}{status === "enabled" && <p>Enabled for this device.</p>}{status === "disabled" && <p>Disabled for this device.</p>}{stage && <p>{stage}</p>}{message && <p className={status === "enabled" ? "success" : "error"}>{message}</p>}{status === "enabled" ? <button type="button" className="action-neutral" disabled={busy} onClick={() => void disable()}>{busy ? "Disabling…" : "Disable phone notifications"}</button> : <button type="button" className="primary account-submit" disabled={busy || status === "unsupported" || status === "unavailable" || status === "denied" || (ios && !installed)} onClick={() => void enable()}>{busy ? stage || "Enabling…" : message ? "Retry phone notifications" : "Enable phone notifications"}</button>}</section>;
}
function BuyerPicker({ buyers, selected, select, add }: { buyers: Buyer[]; selected: any; select: (b: Buyer | null) => void; add: () => void }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const matches = buyers.filter(b => `${b.full_name} ${b.phone} ${b.address || ""}`.toLowerCase().includes(query.toLowerCase()));
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
  return (
    <div className="picker" ref={root}>
      <label>
        Buyer
        <input
          ref={input}
          aria-label="Search or select buyer"
          placeholder="Search or select buyer"
          value={selected ? `${selected?.full_name || ""} — ${selected?.address || ""}` : query}
          onFocus={() => { setOpen(true); if (selected) select(null); }}
          onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
        />
      </label>
      {open && <div className="picker-popover"><button type="button" className="add-row buyer-add-row" onClick={add}><Plus aria-hidden="true" /> Add new buyer</button><div className="picker-results">{matches.map((buyer) => <button type="button" key={buyer.id} onClick={() => { select(buyer); close(); setQuery(""); }}><strong>{buyer.full_name}</strong><small>{buyer.address || "No address"}</small></button>)}{!matches.length && <p>No buyers found</p>}</div></div>}
    </div>
  );
  return <div className="picker" ref={root}><label>Buyer<input ref={input} aria-label="Search or select buyer" placeholder="Search or select buyer" value={selected ? [selected.full_name, selected.address, selected.phone].filter(Boolean).join(" · ") : query} onFocus={() => { setOpen(true); if (selected) select(null); }} onChange={e => { setQuery(e.target.value); setOpen(true); }}/></label>{open && <div className="picker-popover"><button type="button" className="add-row buyer-add-row" onClick={add}><Plus aria-hidden="true" /> Add new buyer</button><div className="picker-results">{matches.map(b => <button type="button" key={b.id} onClick={() => { select(b); close(); setQuery(""); }}><strong>{b.full_name}</strong>{b.address && <small>{b.address}</small>}{b.phone && <small>{b.phone}</small>}</button>)}{!matches.length && <p>No buyers found</p>}</div></div>}</div>;
}
type DraftItem = { p: Product; q: number; unitPriceMinor: number };

function ItemsTable({
  products,
  items,
  setItems,
  role,
  unavailableProductIds,
  onPickerOpen,
  onPickerVisibilityChange,
  onQuantityValidityChange,
  validationAttempt,
}: {
  products: Product[];
  items: DraftItem[];
  setItems: React.Dispatch<React.SetStateAction<DraftItem[]>>;
  role: "ADMIN" | "REP";
  unavailableProductIds: number[];
  onPickerOpen: () => void;
  onPickerVisibilityChange: (open: boolean) => void;
  onQuantityValidityChange: (hasInvalidInput: boolean) => void;
  validationAttempt: number;
}) {
  const [query, setQuery] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [quantityDrafts, setQuantityDrafts] = useState<Record<number, string>>({});
  const [priceDrafts, setPriceDrafts] = useState<Record<number, string>>({});
  const [touchedQuantities, setTouchedQuantities] = useState<Record<number, boolean>>({});
  const [touchedPrices, setTouchedPrices] = useState<Record<number, boolean>>({});
  const [pendingProduct, setPendingProduct] = useState<Product | null>(null);
  const [pendingQuantity, setPendingQuantity] = useState("1");
  const [pendingPrice, setPendingPrice] = useState("");
  const [pendingError, setPendingError] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const matches = products.filter((product) =>
    `${product.brand} ${product.model_name} ${product.sku}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );

  const quantityValue = (productId: number, quantity: number) => quantityDrafts[productId] ?? String(quantity);
  const validQuantity = (value: string) => /^\d+$/.test(value) && Number(value) >= 1;
  const priceValue = (productId: number, price: number) => priceDrafts[productId] ?? (price / 100).toFixed(2);
  const priceMinor = (value: string) => /^\d+(?:\.\d{1,2})?$/.test(value) ? Math.round(Number(value) * 100) : null;
  const validPrice = (product: Product, value: string) => {
    const valueMinor = priceMinor(value);
    return valueMinor !== null && valueMinor >= 0 && (role !== "REP" || valueMinor >= product.price_minor);
  };
  const pendingPriceMinor = priceMinor(pendingPrice);
  const pendingPriceState =
    role === "REP" && pendingPrice !== ""
      ? pendingPriceMinor !== null && pendingPriceMinor >= pendingProduct?.price_minor!
        ? "price-at-minimum"
        : "price-below-minimum"
      : "";
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
  const setPrice = (product: Product, value: string) => {
    setPriceDrafts((drafts) => ({ ...drafts, [product.id]: value }));
    const valueMinor = priceMinor(value);
    if (valueMinor === null) return;
    setItems((current) => current.map((item) => item.p.id === product.id ? { ...item, unitPriceMinor: valueMinor } : item));
  };
  const validatePrice = (productId: number) => setTouchedPrices((touched) => ({ ...touched, [productId]: true }));
  const remove = (productId: number) =>
    setItems((current) => current.filter((item) => item.p.id !== productId));
  const choose = (product: Product) => {
    setPendingProduct(product);
    setPendingQuantity("");
    setPendingPrice("");
    setPendingError("");
    setQuery("");
    setPickerOpen(false);
  };
  const addPendingProduct = () => {
    if (!pendingProduct) return;
    if (!validQuantity(pendingQuantity) || !validPrice(pendingProduct, pendingPrice)) {
      setPendingError(role === "REP" ? "Enter a whole quantity and a price at or above the minimum." : "Enter a whole quantity and a valid non-negative price.");
      return;
    }
    const quantity = Number(pendingQuantity);
    const unitPriceMinor = priceMinor(pendingPrice)!;
    setItems((current) =>
      current.some((item) => item.p.id === pendingProduct.id)
        ? current.map((item) => {
            if (item.p.id !== pendingProduct.id) return item;
            const updatePrice = item.unitPriceMinor !== unitPriceMinor && window.confirm("This item is already selected with a different price. Update the existing line price?");
            return { ...item, q: item.q + quantity, unitPriceMinor: updatePrice ? unitPriceMinor : item.unitPriceMinor };
          })
        : [...current, { p: pendingProduct, q: quantity, unitPriceMinor }],
    );
    setPendingProduct(null);
  };
  const closePicker = (restoreFocus = false) => {
    setPickerOpen(false);
    if (restoreFocus) window.setTimeout(() => trigger.current?.focus(), 0);
  };
  useEffect(() => {
    onPickerVisibilityChange(pickerOpen);
  }, [pickerOpen, onPickerVisibilityChange]);
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
    const invalid = items.some((item) => unavailableProductIds.includes(item.p.id) || !validQuantity(quantityValue(item.p.id, item.q)) || !validPrice(item.p, priceValue(item.p.id, item.unitPriceMinor)));
    onQuantityValidityChange(invalid);
  }, [items, quantityDrafts, priceDrafts, unavailableProductIds]);
  useEffect(() => {
    if (!validationAttempt) return;
    setTouchedQuantities(Object.fromEntries(items.map((item) => [item.p.id, true])));
    setTouchedPrices(Object.fromEntries(items.map((item) => [item.p.id, true])));
  }, [validationAttempt]);

  return (
    <>
      <div className="item-cards" aria-label="Order items">
        {items.map((item, index) => (
          <article className="item-card" key={item.p.id}>
            <div className="item-card-top">
              <span className="item-number">{index + 1}</span>
              <span className="item-description">
                <strong>{productName(item.p)}</strong>
                <small>{item.p.sku}</small>
                {unavailableProductIds.includes(item.p.id) && <small className="field-error">This product is no longer available. Remove it before saving.</small>}
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
              <label>
                Unit price (LKR)
                <input type="text" inputMode="decimal" value={priceValue(item.p.id, item.unitPriceMinor)} onChange={(event) => setPrice(item.p, event.target.value)} onBlur={() => validatePrice(item.p.id)} />
                {role === "REP" && <small>Minimum: {fmt(item.p.price_minor)}</small>}
                {touchedPrices[item.p.id] && !validPrice(item.p, priceValue(item.p.id, item.unitPriceMinor)) && <small className="field-error">{role === "REP" ? "Enter a price at or above the minimum." : "Enter a non-negative price."}</small>}
              </label>
              <span><small>Amount</small><strong>{fmt(item.unitPriceMinor * item.q)}</strong></span>
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
                <td>{productName(item.p)}<small>{item.p.sku}</small></td>
                <td><input type="number" min="1" step="1" value={quantityValue(item.p.id, item.q)} onChange={(event) => setQuantity(item.p.id, event.target.value)} onBlur={() => validateQuantity(item.p.id)} /></td>
                <td><input type="text" inputMode="decimal" value={priceValue(item.p.id, item.unitPriceMinor)} onChange={(event) => setPrice(item.p, event.target.value)} onBlur={() => validatePrice(item.p.id)} />{role === "REP" && <small>Minimum: {fmt(item.p.price_minor)}</small>}</td>
                <td>{fmt(item.unitPriceMinor * item.q)}</td>
                <td><button type="button" className="remove-item" onClick={() => remove(item.p.id)}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button ref={trigger} type="button" className="add-row" onClick={() => { onPickerOpen(); setPickerOpen(true); }}>
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
                  <strong>{productName(product)}</strong>
                  <small>{product.sku} · {fmt(product.price_minor)}</small>
                </button>
              ))}
              {!matches.length && <p>No products found</p>}
            </div>
          </section>
        </div>
      )}
      {pendingProduct && (
        <div className="product-sheet-backdrop item-entry-backdrop" onClick={() => setPendingProduct(null)}>
          <section className="item-entry-dialog" role="dialog" aria-modal="true" aria-label={`Add ${productName(pendingProduct)}`} onClick={(event) => event.stopPropagation()}>
            <h2>Add item</h2>
            <p className="item-entry-name">{productName(pendingProduct)}</p>
            <label>Quantity<input autoFocus inputMode="numeric" value={pendingQuantity} onChange={(event) => setPendingQuantity(event.target.value)} /></label>
            <label>
              Unit price (LKR)
              <input
                className={pendingPriceState}
                inputMode="decimal"
                value={pendingPrice}
                aria-invalid={pendingPriceState === "price-below-minimum" || undefined}
                onChange={(event) => {
                  setPendingPrice(event.target.value);
                  setPendingError("");
                }}
              />
            </label>
            {pendingError && <p className="error">{pendingError}</p>}
            <div className="form-footer"><button type="button" onClick={() => setPendingProduct(null)}>Cancel</button><button type="button" className="primary" onClick={addPendingProduct}>Add</button></div>
          </section>
        </div>
      )}
    </>
  );
}
function JobsPanel({ role, accounts, home = false }: { role: "ADMIN" | "REP"; accounts: any[]; home?: boolean }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [filter, setFilter] = useState<"all" | "active" | "completed" | "cancelled" | "rejected">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openJob, setOpenJob] = useState<Job | null>(null);
  const [busyItem, setBusyItem] = useState<number | null>(null);
  const [responseBusy, setResponseBusy] = useState(false);
  const [rejectingJob, setRejectingJob] = useState<Job | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [repId, setRepId] = useState("");
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [instructions, setInstructions] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [candidates, setCandidates] = useState<Array<Pick<Buyer, "id" | "full_name" | "address">>>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [addressSuggestions, setAddressSuggestions] = useState<string[]>([]);
  const [addressOpen, setAddressOpen] = useState(false);
  const [addressLoading, setAddressLoading] = useState(false);
  const [addressHighlight, setAddressHighlight] = useState(-1);
  const [selectedBuyerIds, setSelectedBuyerIds] = useState<number[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [assignmentKey, setAssignmentKey] = useState(() => crypto.randomUUID());
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const request = useRef(0);
  const addressPicker = useRef<HTMLDivElement | null>(null);
  const addressInput = useRef<HTMLInputElement | null>(null);
  const selectAllMatches = useRef<HTMLInputElement | null>(null);
  const refresh = async (quiet = false) => {
    const current = ++request.current;
    if (!quiet) setLoading(true);
    try {
      const result = await api<Job[]>(`/api/jobs?status=${filter}`);
      if (current === request.current) { setJobs(result); setError(""); }
    } catch (reason) { if (current === request.current) setError((reason as Error).message); }
    finally { if (current === request.current && !quiet) setLoading(false); }
  };
  useEffect(() => { void refresh(); }, [filter]);
  useEffect(() => {
    let disposed = false;
    const update = () => { if (!disposed && document.visibilityState === "visible") void refresh(true); };
    const interval = window.setInterval(update, 15000);
    window.addEventListener("focus", update); window.addEventListener("online", update); document.addEventListener("visibilitychange", update);
    return () => { disposed = true; window.clearInterval(interval); window.removeEventListener("focus", update); window.removeEventListener("online", update); document.removeEventListener("visibilitychange", update); };
  }, [filter]);
  useEffect(() => {
    if (role !== "ADMIN") return;
    let stale = false;
    const query = location.trim();
    setSelectedBuyerIds([]);
    setCandidates([]);
    if (!query) { setCandidatesLoading(false); return; }
    setCandidatesLoading(true);
    const timer = window.setTimeout(() => {
      api<Array<Pick<Buyer, "id" | "full_name" | "address">>>(`/api/jobs/buyer-preview?q=${encodeURIComponent(query)}`)
        .then((rows) => { if (!stale) setCandidates(rows); })
        .catch((reason) => { if (!stale) setError((reason as Error).message); })
        .finally(() => { if (!stale) setCandidatesLoading(false); });
    }, 250);
    return () => { stale = true; window.clearTimeout(timer); };
  }, [role, location]);
  useEffect(() => {
    if (role !== "ADMIN") return;
    let stale = false;
    const query = location.trim();
    if (!addressOpen || !query) { setAddressSuggestions([]); setAddressLoading(false); return; }
    setAddressLoading(true);
    const timer = window.setTimeout(() => {
      api<Array<{ address: string }>>(`/api/jobs/address-suggestions?q=${encodeURIComponent(query)}`)
        .then((rows) => { if (!stale) { setAddressSuggestions(rows.map((row) => row.address)); setAddressHighlight(-1); } })
        .catch((reason) => { if (!stale) setError((reason as Error).message); })
        .finally(() => { if (!stale) setAddressLoading(false); });
    }, 200);
    return () => { stale = true; window.clearTimeout(timer); };
  }, [role, location, addressOpen]);
  useEffect(() => {
    if (!addressOpen) return;
    const close = (event: PointerEvent) => { if (!addressPicker.current?.contains(event.target as Node)) setAddressOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setAddressOpen(false); addressInput.current?.focus(); } };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", escape); };
  }, [addressOpen]);
  useEffect(() => {
    if (selectAllMatches.current) selectAllMatches.current.indeterminate = selectedBuyerIds.some((id) => candidates.some((buyer) => buyer.id === id)) && !candidates.every((buyer) => selectedBuyerIds.includes(buyer.id));
  }, [candidates, selectedBuyerIds]);
  const showJob = async (id: number) => {
    try { setOpenJob(await api<Job>(`/api/jobs/${id}`)); setError(""); }
    catch (reason) { setError((reason as Error).message); }
  };
  const toggleVisit = async (item: JobItem, visited: boolean) => {
    if (!openJob || busyItem) return;
    const previous = openJob;
    setBusyItem(item.id);
    setOpenJob({ ...previous, items: previous.items?.map((current) => current.id === item.id ? { ...current, visited_at: visited ? new Date().toISOString() : null, visited_by_username: visited ? "You" : null } : current) });
    try {
      const updated = await api<Job>(`/api/jobs/${previous.id}/items/${item.id}`, { method: "PUT", body: JSON.stringify({ visited, version: item.version }) });
      setOpenJob(updated); await refresh(true);
    } catch (reason) { setOpenJob(previous); setError((reason as Error).message); }
    finally { setBusyItem(null); }
  };
  const respondToJob = async (job: Job, response: "ACCEPT" | "REJECT", reason?: string) => {
    if (responseBusy) return;
    setResponseBusy(true);
    setError("");
    try {
      const updated = await api<Job>(`/api/jobs/${job.id}/response`, { method: "POST", body: JSON.stringify({ response, reason }) });
      setOpenJob(updated);
      setRejectingJob(null);
      setRejectionReason("");
      await refresh(true);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setResponseBusy(false);
    }
  };
  const responseLabel = (job: Job) => job.response_status === "AWAITING_RESPONSE" ? "Awaiting response" : job.response_status === "ACCEPTED" ? "Accepted" : "Rejected";
  const responseClass = (job: Job) => job.response_status === "ACCEPTED" ? "status-active" : job.response_status === "REJECTED" ? "status-danger" : "status-pending";
  const createJob = async () => {
    if (!repId || !title.trim() || !location.trim() || !selectedBuyerIds.length) { setError("Select an active Rep, enter a title and address search, then select at least one buyer."); return; }
    setSubmitting(true); setError("");
    try {
      await api<Job>("/api/jobs", { method: "POST", body: JSON.stringify({ idempotencyKey: assignmentKey, repId: Number(repId), title, locationQuery: location, instructions, dueDate: dueDate || null, buyerIds: selectedBuyerIds }) });
      setRepId(""); setTitle(""); setLocation(""); setInstructions(""); setDueDate(""); setCandidates([]); setSelectedBuyerIds([]); setAssignmentKey(crypto.randomUUID()); setAssignmentOpen(false); await refresh(true);
    } catch (reason) { setError((reason as Error).message); }
    finally { setSubmitting(false); }
  };
  const matchingSelectedCount = candidates.filter((buyer) => selectedBuyerIds.includes(buyer.id)).length;
  const allMatchingSelected = candidates.length > 0 && matchingSelectedCount === candidates.length;
  const chooseAddress = (address: string) => {
    setLocation(address);
    setAddressOpen(false);
    setAddressSuggestions([]);
    window.setTimeout(() => addressInput.current?.focus(), 0);
  };
  const toggleAllMatching = () => setSelectedBuyerIds((current) => allMatchingSelected ? current.filter((id) => !candidates.some((buyer) => buyer.id === id)) : [...new Set([...current, ...candidates.map((buyer) => buyer.id)])]);
  const activeReps = accounts.filter((account) => account.role === "REP" && account.active);
  return <section className={home ? "jobs-panel jobs-panel-home" : "jobs-panel"}>
    <div className="section-heading"><h1 className="page-title"><BriefcaseBusiness aria-hidden="true" /> {home ? "My Jobs" : "Jobs"}</h1>{role === "ADMIN" && <button type="button" className="add-row" onClick={() => setAssignmentOpen(true)}><Plus aria-hidden="true" /> Assign job</button>}</div>
    {role === "ADMIN" && assignmentOpen && <div className="quote-dialog-backdrop" onClick={() => setAssignmentOpen(false)}><section className="quote-dialog job-assignment-dialog" role="dialog" aria-modal="true" aria-label="Assign a job" onClick={(event) => event.stopPropagation()}>
      <button type="button" className="dialog-close" aria-label="Close assignment form" onClick={() => setAssignmentOpen(false)}><X aria-hidden="true" /></button>
      <h2>Assign a job</h2>
      <label>Rep<select value={repId} onChange={(event) => setRepId(event.target.value)}><option value="">Select active Rep</option>{activeReps.map((rep) => <option key={rep.id} value={rep.id}>{rep.username}</option>)}</select></label>
      <label>Job title<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} /></label>
      <div className="job-address-picker" ref={addressPicker}>
        <label>Address/location search
          <input ref={addressInput} placeholder="Search an active buyer address" value={location} maxLength={200} autoComplete="off" aria-autocomplete="list" aria-expanded={addressOpen} aria-controls="job-address-suggestions" onFocus={() => setAddressOpen(true)} onChange={(event) => { setLocation(event.target.value); setAddressOpen(true); }} onKeyDown={(event) => {
            if (event.key === "ArrowDown" && addressSuggestions.length) { event.preventDefault(); setAddressHighlight((current) => Math.min(current + 1, addressSuggestions.length - 1)); }
            if (event.key === "ArrowUp" && addressSuggestions.length) { event.preventDefault(); setAddressHighlight((current) => Math.max(current - 1, 0)); }
            if (event.key === "Enter" && addressHighlight >= 0 && addressSuggestions[addressHighlight]) { event.preventDefault(); chooseAddress(addressSuggestions[addressHighlight]); }
            if (event.key === "Escape") setAddressOpen(false);
          }} />
        </label>
        {addressOpen && location.trim() && <div id="job-address-suggestions" className="job-address-suggestions" role="listbox" aria-label="Matching addresses">
          {addressLoading && <p>Searching addresses…</p>}
          {!addressLoading && addressSuggestions.map((address, index) => <button type="button" key={address} role="option" aria-selected={addressHighlight === index} className={addressHighlight === index ? "active" : ""} onMouseDown={(event) => event.preventDefault()} onClick={() => chooseAddress(address)}>{address}</button>)}
          {!addressLoading && !addressSuggestions.length && <p>No matching addresses.</p>}
        </div>}
      </div>
      <label>Instructions (optional)<textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} maxLength={2000} /></label>
      <label>Due date (optional)<input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>
      <div className="job-buyer-preview">
        <div className="job-buyer-preview-heading"><strong>Matching active buyers</strong><small>{matchingSelectedCount} of {candidates.length} selected</small></div>
        <label className="job-buyer-choice job-select-all"><input ref={selectAllMatches} type="checkbox" disabled={candidatesLoading || !candidates.length} checked={allMatchingSelected} onChange={toggleAllMatching} /><span><b>All matching buyers ({candidates.length})</b><small>Select or clear every buyer matching this address.</small></span></label>
        {candidatesLoading ? <p>Loading matching buyers…</p> : candidates.length ? candidates.map((buyer) => <label key={buyer.id} className="job-buyer-choice"><input type="checkbox" checked={selectedBuyerIds.includes(buyer.id)} onChange={() => setSelectedBuyerIds((current) => current.includes(buyer.id) ? current.filter((id) => id !== buyer.id) : [...current, buyer.id])} /><span><b>{buyer.full_name}</b><small className="preserve-lines">{buyer.address}</small></span></label>) : <p>{location.trim() ? "No active buyers match this address." : "Search an address to preview buyers."}</p>}
      </div>
      <div className="form-footer form-footer-right"><button type="button" onClick={() => setAssignmentOpen(false)}>Cancel</button><button type="button" className="primary" disabled={submitting || !selectedBuyerIds.length} onClick={createJob}>{submitting ? "Assigning…" : `Assign job${selectedBuyerIds.length ? ` (${selectedBuyerIds.length})` : ""}`}</button></div>
    </section></div>}
    <div className="account-tabs dispatch-tabs job-tabs" aria-label={role === "REP" ? "My jobs filter" : "Jobs filter"}><button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>All</button><button className={filter === "active" ? "active" : ""} onClick={() => setFilter("active")}>Active</button><button className={filter === "completed" ? "active" : ""} onClick={() => setFilter("completed")}>Completed</button><button className={filter === "cancelled" ? "active" : ""} onClick={() => setFilter("cancelled")}>Cancelled</button><button className={filter === "rejected" ? "active" : ""} onClick={() => setFilter("rejected")}>Rejected</button></div>
    {error && <p className="error">{error}</p>}{loading && <p>Loading jobs…</p>}{!loading && !jobs.length && <p className="empty-state">{role === "REP" ? "No jobs are assigned to you." : "No jobs found."}</p>}
    <div className="job-list">{jobs.map((job) => <article className={`job-card job-${job.status.toLowerCase()}`} key={job.id}><button type="button" className="job-card-open" onClick={() => void showJob(job.id)}><span><strong>{job.title}</strong><small className="job-location"><MapPin aria-hidden="true" /><span>{job.location_query}</span></small><small>{role === "ADMIN" ? `Rep: ${job.assigned_rep_username}` : job.due_date ? `Due ${job.due_date}` : "No due date"}</small></span><span className="job-progress"><b>{job.visited_count ?? job.progress?.visited ?? 0} of {job.item_count ?? job.progress?.total ?? 0}</b><small>shops visited</small><span className={`status-badge ${responseClass(job)}`}>{responseLabel(job)}</span><span className={`status-badge ${job.status === "COMPLETED" ? "status-active" : job.status === "CANCELLED" ? "status-danger" : "status-pending"}`}>{job.status[0] + job.status.slice(1).toLowerCase()}</span></span></button>{role === "ADMIN" && job.status !== "CANCELLED" && <div className="job-card-actions"><button type="button" className="icon-action action-edit" aria-label={`Edit ${job.title}`} title="Edit job" onClick={async (event) => { event.stopPropagation(); const nextTitle = window.prompt("Job title", job.title); if (nextTitle === null) return; const nextInstructions = window.prompt("Instructions", job.instructions || ""); if (nextInstructions === null) return; const nextDue = window.prompt("Due date (YYYY-MM-DD, optional)", job.due_date || ""); if (nextDue === null) return; try { await api(`/api/jobs/${job.id}`, { method: "PUT", body: JSON.stringify({ title: nextTitle, instructions: nextInstructions, dueDate: nextDue || null }) }); await refresh(true); } catch (reason) { setError((reason as Error).message); } }}><Pencil aria-hidden="true" /></button><button type="button" className="icon-action action-danger" aria-label={`Cancel ${job.title}`} title="Cancel job" onClick={async (event) => { event.stopPropagation(); const reason = window.prompt(`Reason for cancelling ${job.title}:`); if (!reason?.trim() || !window.confirm(`Cancel job ${job.title}?`)) return; try { await api(`/api/jobs/${job.id}/cancel`, { method: "POST", body: JSON.stringify({ reason }) }); await refresh(true); if (openJob?.id === job.id) setOpenJob(null); } catch (reason) { setError((reason as Error).message); } }}><Trash2 aria-hidden="true" /></button></div>}</article>)}</div>
    {openJob && <div className="quote-dialog-backdrop" onClick={() => setOpenJob(null)}><section className="quote-dialog job-detail-dialog" role="dialog" aria-modal="true" aria-label={openJob.title} onClick={(event) => event.stopPropagation()}><button type="button" className="dialog-close" aria-label="Close job" onClick={() => setOpenJob(null)}><X aria-hidden="true" /></button><h2>{openJob.title}</h2><p><MapPin aria-hidden="true" /> {openJob.location_query}</p>{openJob.instructions && <p className="preserve-lines">{openJob.instructions}</p>}{openJob.due_date && <p><strong>Due:</strong> {openJob.due_date}</p>}<p><strong>Rep response:</strong> <span className={`status-badge ${responseClass(openJob)}`}>{responseLabel(openJob)}</span></p>{openJob.responded_at && <p><strong>Responded:</strong> {formatOrderDateTime(openJob.responded_at)}{openJob.responded_by_username ? ` by ${openJob.responded_by_username}` : ""}</p>}{openJob.response_status === "REJECTED" && <p className="error"><strong>Reason:</strong> {openJob.rejection_reason}</p>}{openJob.status === "CANCELLED" && <p className="error">Cancelled: {openJob.cancellation_reason}</p>}{role === "REP" && openJob.status !== "CANCELLED" && openJob.response_status === "AWAITING_RESPONSE" && <div className="job-response-actions"><button type="button" className="primary" disabled={responseBusy} onClick={() => void respondToJob(openJob, "ACCEPT")}>{responseBusy ? "Saving…" : "Accept"}</button><button type="button" className="danger-button" disabled={responseBusy} onClick={() => { setRejectingJob(openJob); setRejectionReason(""); }}>Reject</button></div>}{role === "REP" && openJob.response_status !== "ACCEPTED" && openJob.status !== "CANCELLED" && <p className="helper-text">Accept this job before updating visit progress.</p>}<div className="job-checklist">{openJob.items?.map((item) => <label key={item.id} className={item.visited_at ? "visited" : ""}><input type="checkbox" checked={Boolean(item.visited_at)} disabled={role !== "REP" || openJob.status === "CANCELLED" || openJob.response_status !== "ACCEPTED" || busyItem === item.id} onChange={(event) => void toggleVisit(item, event.target.checked)} /><span>{item.visited_at ? <CheckCircle2 aria-hidden="true" /> : <Circle aria-hidden="true" />}</span><span><strong>{item.buyer_name}</strong><small className="preserve-lines">{item.buyer_address}</small>{item.visited_at && <small>Visited {formatOrderDateTime(item.visited_at)}{item.visited_by_username ? ` by ${item.visited_by_username}` : ""}</small>}</span></label>)}</div></section></div>}
    {rejectingJob && <div className="quote-dialog-backdrop" onClick={() => !responseBusy && setRejectingJob(null)}><section className="quote-dialog job-response-dialog" role="dialog" aria-modal="true" aria-label={`Reject ${rejectingJob.title}`} onClick={(event) => event.stopPropagation()}><button type="button" className="dialog-close" aria-label="Close rejection form" disabled={responseBusy} onClick={() => setRejectingJob(null)}><X aria-hidden="true" /></button><h2>Reject job</h2><p>{rejectingJob.title}</p><label>Reason<textarea autoFocus value={rejectionReason} maxLength={1000} onChange={(event) => setRejectionReason(event.target.value)} placeholder="Why can this job not be accepted?" /></label><div className="form-footer"><button type="button" disabled={responseBusy} onClick={() => setRejectingJob(null)}>Cancel</button><button type="button" className="danger-button" disabled={responseBusy || !rejectionReason.trim()} onClick={() => void respondToJob(rejectingJob, "REJECT", rejectionReason)}>{responseBusy ? "Saving…" : "Reject job"}</button></div></section></div>}
  </section>;
}
type DispatchTargetData = { month: string; actual: { orders: number; valueMinor: number }; target: { order_target: number; value_target_minor: number; version: number; updated_by_username: string; updated_at: string } | null; refreshedAt: string };
function DispatchTargetsDialog({ close }: { close: () => void }) {
  const [month, setMonth] = useState(() => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Colombo", year: "numeric", month: "2-digit" }).formatToParts(new Date()).reduce((value, part) => part.type === "year" ? { ...value, year: part.value } : part.type === "month" ? { ...value, month: part.value } : value, {} as Record<string, string>));
  const monthKey = `${month.year}-${month.month}`;
  const [data, setData] = useState<DispatchTargetData | null>(null), [error, setError] = useState(""), [loading, setLoading] = useState(true), [editing, setEditing] = useState(false), [orders, setOrders] = useState(""), [value, setValue] = useState(""), [saving, setSaving] = useState(false);
  const request = useRef(0);
  const refresh = async (quiet = false) => { const sequence = ++request.current; if (!quiet) setLoading(true); try { const result = await api<DispatchTargetData>(`/api/dispatch-targets?month=${monthKey}`); if (sequence === request.current) { setData(result); setError(""); if (!editing) { setOrders(result.target ? String(result.target.order_target) : ""); setValue(result.target ? (result.target.value_target_minor / 100).toFixed(2) : ""); } } } catch (reason) { if (sequence === request.current) setError((reason as Error).message); } finally { if (sequence === request.current && !quiet) setLoading(false); } };
  useEffect(() => { void refresh(); }, [monthKey]);
  useEffect(() => { const update = () => document.visibilityState === "visible" && void refresh(true); const timer = window.setInterval(update, 15000); window.addEventListener("focus", update); window.addEventListener("online", update); return () => { window.clearInterval(timer); window.removeEventListener("focus", update); window.removeEventListener("online", update); }; }, [monthKey, editing]);
  useEffect(() => { const escape = (event: KeyboardEvent) => event.key === "Escape" && close(); window.addEventListener("keydown", escape); return () => window.removeEventListener("keydown", escape); }, [close]);
  const changeMonth = (delta: number) => { const [year, monthNumber] = monthKey.split("-").map(Number); const next = new Date(Date.UTC(year, monthNumber - 1 + delta, 1)); setMonth({ year: String(next.getUTCFullYear()), month: String(next.getUTCMonth() + 1).padStart(2, "0") }); setEditing(false); };
  const meter = (label: string, actual: number, target: number | undefined, suffix: string) => { if (!target) return <article className="target-meter"><strong>{label}</strong><p>Targets not set</p></article>; const percent = actual / target * 100, visual = Math.min(percent, 100), tone = percent < 50 ? "danger" : percent < 80 ? "amber" : percent < 100 ? "blue" : "success", remaining = target - actual; return <article className={`target-meter ${tone}`}><strong>{label}</strong><div className="target-ring" style={{ "--progress": `${visual}%` } as any}><b>{percent.toFixed(0)}%</b></div><b>{suffix}</b><small>{remaining >= 0 ? `${remaining} remaining` : `${Math.abs(remaining)} exceeded`}</small></article>; };
  const save = async () => { const orderTarget = Number(orders), valueTargetMinor = Math.round(Number(value) * 100); if (!Number.isInteger(orderTarget) || orderTarget < 1 || !/^\d+(?:\.\d{1,2})?$/.test(value) || valueTargetMinor < 1) { setError("Enter a positive whole order target and a positive LKR value with up to two decimals."); return; } setSaving(true); try { await api("/api/dispatch-targets", { method: "PUT", body: JSON.stringify({ month: monthKey, orderTarget, valueTargetMinor, version: data?.target?.version ?? null }) }); setEditing(false); await refresh(true); } catch (reason) { setError((reason as Error).message); } finally { setSaving(false); } };
  const title = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Colombo", month: "long", year: "numeric" }).format(new Date(`${monthKey}-01T00:00:00Z`));
  return <div className="quote-dialog-backdrop" onClick={close}><section className="quote-dialog dispatch-target-dialog" role="dialog" aria-modal="true" aria-label="Dispatch targets" onClick={(event) => event.stopPropagation()}><button className="dialog-close" onClick={close} aria-label="Close dispatch targets"><X /></button><div className="section-heading"><h2><Gauge /> Dispatch targets</h2><button className="icon-action" aria-label="Set targets" title="Set targets" onClick={() => setEditing(true)}><Pencil /></button></div><div className="target-period"><button onClick={() => changeMonth(-1)} aria-label="Previous month">‹</button><strong>{title}</strong><button onClick={() => changeMonth(1)} aria-label="Next month">›</button></div>{error && <p className="error">{error}</p>}{loading && !data ? <p>Loading targets…</p> : <><div className="target-meters">{meter("Current dispatched orders", data?.actual.orders || 0, data?.target?.order_target, `${data?.actual.orders || 0} / ${data?.target?.order_target || "—"} orders`)}{meter("Dispatched order value", data?.actual.valueMinor || 0, data?.target?.value_target_minor, `${fmt(data?.actual.valueMinor || 0)} / ${data?.target ? fmt(data.target.value_target_minor) : "—"}`)}</div>{data?.target && <small>Updated by {data.target.updated_by_username} · {formatOrderDateTime(data.target.updated_at)}</small>}{editing && <div className="target-form"><label>Target dispatched orders<input inputMode="numeric" value={orders} onChange={(event) => setOrders(event.target.value)} /></label><label>Target dispatched value (LKR)<input inputMode="decimal" value={value} onChange={(event) => setValue(event.target.value)} /></label><div className="form-footer"><button onClick={() => setEditing(false)} disabled={saving}>Cancel</button><button className="primary" onClick={() => void save()} disabled={saving}>{saving ? "Saving…" : "Save targets"}</button></div></div>}{!data?.target && !editing && <button className="primary" onClick={() => setEditing(true)}>Set targets</button>}</>}</section></div>;
}
function RepHome({ orders, accounts }: { orders: any[]; accounts: any[] }) {
  const [counts, setCounts] = useState({ all: 0, pending: 0, dispatched: 0 });
  const [error, setError] = useState("");
  useEffect(() => {
    let stale = false;
    const refreshCounts = () => {
      if (document.visibilityState === "hidden") return;
      api<any[]>("/api/quotations?status=all").then((result) => { if (!stale) setCounts({ all: result.length, pending: result.filter((order) => !order.dispatched_at && !order.cancelled_at).length, dispatched: result.filter((order) => order.dispatched_at && !order.cancelled_at).length }); }).catch((reason) => !stale && setError((reason as Error).message));
    };
    refreshCounts();
    const onVisible = () => refreshCounts();
    const timer = window.setInterval(refreshCounts, 15000);
    window.addEventListener("focus", onVisible); window.addEventListener("online", onVisible); document.addEventListener("visibilitychange", onVisible);
    return () => { stale = true; window.clearInterval(timer); window.removeEventListener("focus", onVisible); window.removeEventListener("online", onVisible); document.removeEventListener("visibilitychange", onVisible); };
  }, [orders]);
  return <><section className="rep-home"><div className="section-heading"><h1 className="page-title"><BriefcaseBusiness aria-hidden="true" /> Home</h1></div><div className="rep-summary-grid"><button type="button" className="rep-summary all-summary" onClick={() => window.dispatchEvent(new CustomEvent("rsk-open-orders", { detail: "all" }))}><span>My orders</span><strong>{counts.all}</strong></button><button type="button" className="rep-summary pending-summary" onClick={() => window.dispatchEvent(new CustomEvent("rsk-open-orders", { detail: "pending" }))}><span>Pending orders</span><strong>{counts.pending}</strong></button><button type="button" className="rep-summary dispatched-summary" onClick={() => window.dispatchEvent(new CustomEvent("rsk-open-orders", { detail: "dispatched" }))}><span>Dispatched orders</span><strong>{counts.dispatched}</strong></button></div>{error && <p className="error">{error}</p>}</section><JobsPanel role="REP" accounts={accounts} home /></>;
}
function SessionSplash({ error, retry }: { error: string; retry: () => void }) {
  return <main className="session-splash" aria-live="polite">
    <div className="session-splash-content">
      <img className="session-splash-wordmark" src="/rsk-holdings-wordmark.png" alt="RSK Holdings (PVT) LTD" />
      {error ? <div className="session-splash-retry"><p>{error}</p><button type="button" className="primary" onClick={retry}>Retry</button></div> : <><span className="session-spinner" aria-hidden="true" /><p>Restoring your session…</p></>}
    </div>
  </main>;
}
function App() {
  const [ok, setOk] = useState(false),
    [sessionLoading, setSessionLoading] = useState(true),
    [sessionError, setSessionError] = useState(""),
    [sessionAttempt, setSessionAttempt] = useState(0),
    [role, setRole] = useState<"ADMIN" | "REP" | "STOREKEEPER">("REP"),
    [username, setUsername] = useState(""),
    [accounts, setAccounts] = useState<any[]>([]),
    [accountUsername, setAccountUsername] = useState(""),
    [accountPassword, setAccountPassword] = useState(""),
    [accountRole, setAccountRole] = useState<"REP" | "STOREKEEPER">("REP"),
    [currentPassword, setCurrentPassword] = useState(""),
    [newPassword, setNewPassword] = useState(""),
    [accountError, setAccountError] = useState(""),
    [accountNotice, setAccountNotice] = useState(""),
    [deletingAccountId, setDeletingAccountId] = useState<number | null>(null),
    [page, setPage] = useState("quote"),
    [bs, setBs] = useState<Buyer[]>([]),
    [ps, setPs] = useState<Product[]>([]),
    [b, setB] = useState<Buyer | null>(null),
    [its, setIts] = useState<DraftItem[]>([]),
    [saved, setSaved] = useState<Quotation | null>(null),
    [savedMode, setSavedMode] = useState<"success" | "detail" | null>(null),
    [draftPreview, setDraftPreview] = useState<Quotation | null>(null),
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
    [productForm, setProductForm] = useState<Product | null | undefined>(undefined),
    [err, setErr] = useState(""),
    [saving, setSaving] = useState(false),
    [quantityInvalid, setQuantityInvalid] = useState(false),
    [quantityValidationAttempt, setQuantityValidationAttempt] = useState(0),
    [orderKey, setOrderKey] = useState(newOrderKey),
    [formResetKey, setFormResetKey] = useState(0),
    [buyerFormDirty, setBuyerFormDirty] = useState(false),
    [buyerForm, setBuyerForm] = useState<Buyer | null | undefined>(undefined),
    [pdfHeader, setPdfHeader] = useState<Settings | null>(null),
    [pdfHeaderBusy, setPdfHeaderBusy] = useState(false),
    [accountSection, setAccountSection] = useState<"profile" | "pdf" | "team">("profile"),
    [itemPickerOpen, setItemPickerOpen] = useState(false),
    [syncNotice, setSyncNotice] = useState(""),
    [orderStatus, setOrderStatus] = useState<"all" | "pending" | "dispatched" | "cancelled">("all"),
    [statusCounts, setStatusCounts] = useState({ pending: 0, dispatched: 0, cancelled: 0 }),
    [dispatchDetail, setDispatchDetail] = useState<any | null>(null),
    [dispatchNotes, setDispatchNotes] = useState(""),
    [deliveryReference, setDeliveryReference] = useState(""),
    [dispatchBusy, setDispatchBusy] = useState(false),
    [notificationOpen, setNotificationOpen] = useState(false),
    [notifications, setNotifications] = useState<any[]>([]),
    [unreadNotifications, setUnreadNotifications] = useState(0),
    [notificationsNext, setNotificationsNext] = useState<number | null>(null),
    [notificationError, setNotificationError] = useState(""),
    [foregroundNotification, setForegroundNotification] = useState<any | null>(null);
  const [dispatchTargetsOpen, setDispatchTargetsOpen] = useState(false);
  const dialogTrigger = useRef<HTMLElement | null>(null);
  const lastFocusedField = useRef<HTMLElement | null>(null);
  const refreshInFlight = useRef(false);
  const refreshSequence = useRef(0);
  const historyRequestSequence = useRef(0);
  const productRequestSequence = useRef(0);
  const newestNotificationId = useRef<number | null>(null);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const refreshBuyers = () => api<Buyer[]>("/api/buyers").then((buyers) => {
    setBs(buyers);
    if (!buyerQuery) setBuyerResults(buyers);
    return buyers;
  });
  const refreshProductsQuietly = async () => {
    const sequence = ++refreshSequence.current;
    const products = await api<Product[]>("/api/products");
    if (sequence !== refreshSequence.current) return;
    setPs(products);
    setIts((current) => current.map((item) => {
      const fresh = products.find((product) => product.id === item.p.id);
      return fresh ? { ...item, p: fresh } : item;
    }));
  };
  useEffect(() => {
    let stale = false;
    const startedAt = Date.now();
    const waitForMinimumSplash = () => new Promise<void>((resolve) => window.setTimeout(resolve, Math.max(0, 1000 - (Date.now() - startedAt))));
    const restore = async () => {
      setSessionLoading(true);
      setSessionError("");
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 12_000);
      try {
        const response = await fetch("/api/session", { headers: { "Content-Type": "application/json" }, signal: controller.signal });
        if (response.status === 401 || response.status === 403) {
          await waitForMinimumSplash();
          if (!stale) { setOk(false); setSessionLoading(false); }
          return;
        }
        if (!response.ok) throw Error(`Session restoration failed (${response.status}).`);
        const s = await response.json();
        csrf = s.csrfToken;
        setRole(s.role);
        setUsername(s.username);
        const target = new URLSearchParams(location.search).get("notification");
        if (target === "order-pending") setOrderStatus("pending");
        setPage(target === "order" || target === "order-pending" ? "history" : target === "job" ? (s.role === "ADMIN" ? "jobs" : "home") : s.role === "STOREKEEPER" ? "dashboard" : s.role === "REP" ? "home" : "quote");
        let initialDataTimer: number | undefined;
        try {
          const initialData = s.role === "STOREKEEPER"
            ? Promise.resolve([[], [], null] as [Buyer[], Product[], Settings | null])
            : Promise.all([api<Buyer[]>("/api/buyers"), api<Product[]>("/api/products"), api<Settings>("/api/settings")]) as Promise<[Buyer[], Product[], Settings | null]>;
          const [buyers, products, settings] = await Promise.race([
            initialData,
            new Promise<never>((_, reject) => { initialDataTimer = window.setTimeout(() => reject(Object.assign(Error("Session restoration timed out."), { name: "AbortError" })), 12_000); }),
          ]);
          await waitForMinimumSplash();
          if (stale) return;
          setBs(buyers);
          setPs(products);
          setPdfHeader(settings);
        } finally {
          if (initialDataTimer) window.clearTimeout(initialDataTimer);
        }
        setOk(true);
        setSessionLoading(false);
      } catch (reason) {
        await waitForMinimumSplash();
        if (!stale) setSessionError((reason as Error).name === "AbortError" ? "Session restoration timed out. Check your connection and try again." : "Could not restore your session. Your account has not been signed out.");
      } finally {
        window.clearTimeout(timeout);
      }
    };
    void restore();
    return () => { stale = true; };
  }, [sessionAttempt]);
  useEffect(() => {
    // HTTPS development tunnels need a worker too; plain local Vite remains unaffected.
    if (!("serviceWorker" in navigator) || (!import.meta.env.PROD && !window.isSecureContext)) return;
    void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
  }, []);
  const refreshAccounts = () => role === "ADMIN" && api<any[]>("/api/accounts").then(setAccounts).catch((error) => setAccountError((error as Error).message));
  useEffect(() => { if (ok && role === "ADMIN") refreshAccounts(); }, [ok, role]);
  const refreshNotifications = async (before?: number) => {
    try { const result = await api<any>(`/api/notifications?limit=20${before ? `&before=${before}` : ""}`); const newest = result.notifications[0]; if (!before && newest && newestNotificationId.current !== null && newest.id > newestNotificationId.current && document.visibilityState === "visible") setForegroundNotification(newest); if (!before && newest) newestNotificationId.current = Math.max(newestNotificationId.current || 0, newest.id); setNotifications((current) => before ? [...current, ...result.notifications] : result.notifications); setUnreadNotifications(result.unread); setNotificationsNext(result.nextBefore); setNotificationError(""); } catch (reason) { setNotificationError((reason as Error).message); }
  };
  useEffect(() => { if (!ok) return; void refreshNotifications(); const refresh = () => { if (document.visibilityState === "visible") void refreshNotifications(); }; const timer = window.setInterval(refresh, 15000); window.addEventListener("focus", refresh); window.addEventListener("online", refresh); return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); window.removeEventListener("online", refresh); }; }, [ok]);
  useEffect(() => { const badging = navigator as Navigator & { setAppBadge?: (count?: number) => Promise<void>; clearAppBadge?: () => Promise<void> }; if (!ok || !badging.setAppBadge || !badging.clearAppBadge) return; void (unreadNotifications > 0 ? badging.setAppBadge(unreadNotifications) : badging.clearAppBadge()).catch(() => undefined); }, [ok, unreadNotifications]);
  useEffect(() => { if (!ok || !("serviceWorker" in navigator)) return; const message = (event: MessageEvent) => { if (event.data?.type === "RSK_FOREGROUND_NOTIFICATION") { setForegroundNotification(event.data.notification); void refreshNotifications(); } }; navigator.serviceWorker.addEventListener("message", message); return () => navigator.serviceWorker.removeEventListener("message", message); }, [ok]);
  useEffect(() => {
    const openOrders = (event: Event) => {
      const status = (event as CustomEvent<"all" | "pending" | "dispatched">).detail;
      setOrderStatus(status || "all");
      setPage("history");
    };
    window.addEventListener("rsk-open-orders", openOrders);
    return () => window.removeEventListener("rsk-open-orders", openOrders);
  }, []);
  useEffect(() => {
    if (!ok) return;
    let stale = false;
    const requestSequence = ++historyRequestSequence.current;
    setHistoryLoading(true);
    setHistoryError("");
    const timer = window.setTimeout(() => {
      api<any>(`/api/quotations?q=${encodeURIComponent(historyQuery)}&status=${orderStatus}`)
        .then((result) => {
          const orders = role === "STOREKEEPER" ? result.orders : result;
          if (!stale && requestSequence === historyRequestSequence.current) { setHistory(orders); if (role === "STOREKEEPER") setStatusCounts(result.counts); }
        })
        .catch((error) => {
          if (!stale && requestSequence === historyRequestSequence.current) setHistoryError((error as Error).message);
        })
        .finally(() => {
          if (!stale && requestSequence === historyRequestSequence.current) setHistoryLoading(false);
        });
    }, 250);
    return () => {
      stale = true;
      window.clearTimeout(timer);
    };
  }, [ok, historyQuery, role, orderStatus]);
  useEffect(() => {
    if (!ok || role === "STOREKEEPER") return;
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
    if (!ok || role === "STOREKEEPER") return;
    let stale = false;
    const requestSequence = ++productRequestSequence.current;
    setProductLoading(true);
    setProductError("");
    const timer = window.setTimeout(() => {
      api<Product[]>(`/api/products?q=${encodeURIComponent(productQuery)}`)
        .then((products) => { if (!stale && requestSequence === productRequestSequence.current) setProductResults(products); })
        .catch((error) => { if (!stale && requestSequence === productRequestSequence.current) setProductError((error as Error).message); })
        .finally(() => { if (!stale && requestSequence === productRequestSequence.current) setProductLoading(false); });
    }, 250);
    return () => { stale = true; window.clearTimeout(timer); };
  }, [ok, productQuery]);
  useEffect(() => {
    if (!ok) return;
    const needsProducts = role !== "STOREKEEPER" && (page === "quote" || page === "products" || itemPickerOpen);
    const needsOrders = page === "history" || (page === "dashboard" && role === "STOREKEEPER") || Boolean(saved) || Boolean(dispatchDetail);
    if (!needsProducts && !needsOrders) return;
    let disposed = false;
    const refresh = async () => {
      if (disposed || document.visibilityState === "hidden" || refreshInFlight.current) return;
      refreshInFlight.current = true;
      try {
        const tasks: Promise<void>[] = [];
        if (needsProducts) tasks.push(refreshProductsQuietly().then(async () => {
          if (page === "products") {
            const requestSequence = ++productRequestSequence.current;
            const results = await api<Product[]>(`/api/products?q=${encodeURIComponent(productQuery)}`);
            if (!disposed && requestSequence === productRequestSequence.current) setProductResults(results);
          }
        }));
        if (needsOrders) tasks.push((async () => {
          const requestSequence = ++historyRequestSequence.current;
          const result = await api<any>(`/api/quotations?q=${encodeURIComponent(historyQuery)}&status=${orderStatus}`);
          const orders = role === "STOREKEEPER" ? result.orders : result;
          if (!disposed && requestSequence === historyRequestSequence.current) {
            setHistory(orders); if (role === "STOREKEEPER") setStatusCounts(result.counts);
            if (saved && !orders.some((order: any) => order.id === saved.id)) {
              setSaved(null);
              setSavedMode(null);
              setHistoryError("This order is no longer available.");
            }
            if (dispatchDetail && role === "STOREKEEPER") {
              try {
                const refreshed = await api<any>(`/api/quotations/${dispatchDetail.id}`);
                const hasUnsavedNotes = dispatchNotes !== (dispatchDetail.dispatch_notes || "") || deliveryReference !== (dispatchDetail.delivery_reference || "");
                if (refreshed.dispatch_version !== dispatchDetail.dispatch_version && hasUnsavedNotes) setSyncNotice("Packing changed elsewhere. Your dispatch notes were kept; review the checklist before saving.");
                else if (refreshed.dispatch_version !== dispatchDetail.dispatch_version) setDispatchDetail(refreshed);
              } catch {
                setDispatchDetail(null);
                setHistoryError("This order is no longer available.");
              }
            }
          }
        })());
        await Promise.all(tasks);
        if (!disposed) setSyncNotice("");
      } catch {
        if (!disposed) setSyncNotice("Offline — showing last synced information.");
      } finally {
        refreshInFlight.current = false;
      }
    };
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    const onOnline = () => void refresh();
    void refresh();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("online", onOnline);
    const timer = window.setInterval(refresh, 15000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("online", onOnline);
    };
  }, [ok, page, itemPickerOpen, saved?.id, dispatchDetail?.id, historyQuery, productQuery, role, orderStatus, dispatchNotes, deliveryReference]);
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
      document.documentElement.style.setProperty("--visual-viewport-height", `${Math.round(viewportHeight())}px`);
      document.documentElement.style.setProperty("--visual-viewport-offset-top", `${Math.round(viewport?.offsetTop || 0)}px`);
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
      window.setTimeout(update, 0);
    };
    update();
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", orientationChange);
    return () => {
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", orientationChange);
      document.documentElement.style.removeProperty("--visual-viewport-height");
      document.documentElement.style.removeProperty("--visual-viewport-offset-top");
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
  if (sessionLoading) return <SessionSplash error={sessionError} retry={() => setSessionAttempt((attempt) => attempt + 1)} />;
  if (!ok) return <Login />;
  const unavailableItems = its.filter((item) => !ps.some((product) => product.id === item.p.id && product.active));
  const total = its.reduce((n, i) => n + i.unitPriceMinor * i.q, 0);
  const previewOrder = async () => {
    if (quantityInvalid) {
      setErr("Correct the invalid item quantities or prices before previewing.");
      setQuantityValidationAttempt((attempt) => attempt + 1);
      return;
    }
    if (unavailableItems.length) return setErr("Remove unavailable products before previewing this order.");
    if (!b || !its.length) return setErr("Choose a buyer and at least one product.");
    setErr("");
    try {
      const preview = await api<Quotation>("/api/quotations/preview", {
        method: "POST",
        body: JSON.stringify({ idempotencyKey: orderKey, buyerId: b.id, quotationDate: new Date().toISOString().slice(0, 10), items: its.map((item) => ({ productId: item.p.id, quantity: item.q, unitPriceMinor: item.unitPriceMinor })) }),
      });
      setDraftPreview(preview);
    } catch (error) { setErr((error as Error).message); }
  };
  const confirmSave = async () => {
    if (saving) return;
    if (quantityInvalid) {
      setErr("Correct the invalid item quantities or prices before saving.");
      setQuantityValidationAttempt((attempt) => attempt + 1);
      return;
    }
    if (unavailableItems.length) return setErr("Remove unavailable products before saving this order.");
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
          items: its.map((i) => ({ productId: i.p.id, quantity: i.q, unitPriceMinor: i.unitPriceMinor })),
        }),
      });
      setSaved(q);
      setSavedMode("success");
      setDraftPreview(null);
      setHistory((current) => [q, ...current]);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const openOrder = (id: number, trigger: HTMLElement) => {
    dialogTrigger.current = trigger;
    api<any>(`/api/quotations/${id}`)
      .then((order) => {
        if (role === "STOREKEEPER") {
          setDispatchDetail(order);
          setDispatchNotes(order.dispatch_notes || "");
          setDeliveryReference(order.delivery_reference || "");
        } else {
          setSaved(order);
          setSavedMode("detail");
        }
      })
      .catch((error) => setHistoryError((error as Error).message));
  };
  const savePacking = async (items: any[]) => {
    if (!dispatchDetail || dispatchBusy) return;
    setDispatchBusy(true);
    try {
      const updated = await api<any>(`/api/quotations/${dispatchDetail.id}/packing`, { method: "PUT", body: JSON.stringify({ version: dispatchDetail.dispatch_version, items: items.map((item) => ({ productId: item.product_id, checked: Boolean(item.packing_checked) })) }) });
      setDispatchDetail(updated);
    } catch (error) { setHistoryError((error as Error).message); } finally { setDispatchBusy(false); }
  };
  const markDispatched = async () => {
    if (!dispatchDetail || dispatchBusy) return;
    if (!dispatchDetail.items.every((item: any) => item.packing_checked)) return setHistoryError("Complete the packing checklist before dispatching.");
    if (!window.confirm(`Mark ${orderReference(dispatchDetail)} for ${dispatchDetail.buyer_name} as dispatched?`)) return;
    setDispatchBusy(true);
    try {
      const updated = await api<any>(`/api/quotations/${dispatchDetail.id}/dispatch`, { method: "POST", body: JSON.stringify({ notes: dispatchNotes, deliveryReference }) });
      setDispatchDetail(updated);
      setHistory((current) => current.filter((order) => order.id !== updated.id));
    } catch (error) { setHistoryError((error as Error).message); } finally { setDispatchBusy(false); }
  };
  const navigate = (nextPage: string) => {
    if (buyerFormDirty && !window.confirm("Discard unsaved buyer changes?")) return;
    setBuyerFormDirty(false);
    if (buyerForm !== undefined) setBuyerForm(undefined);
    setPage(nextPage);
  };
  const logout = async () => {
    if (buyerFormDirty && !window.confirm("Discard unsaved buyer changes and log out?")) return;
    try {
      const registration = await navigator.serviceWorker?.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) await api("/api/push/subscriptions", { method: "DELETE", body: JSON.stringify({ endpoint: subscription.endpoint }) });
      await (navigator as Navigator & { clearAppBadge?: () => Promise<void> }).clearAppBadge?.();
    } catch {
      // Logout must still succeed when Push is unavailable.
    }
    await api("/api/logout", { method: "POST" });
    location.reload();
  };
  return (
    <div className={`app-shell${keyboardOpen ? " keyboard-open" : ""}`}>
      <PwaUpdateNotice />
      <header className="topbar">
        <div className="topbar-identity">
          <img className="brand-wordmark" src="/rsk-holdings-wordmark.png" alt="RSK Holdings (PVT) LTD" />
          <span title={username}>{username}</span>
        </div>
        {role === "ADMIN" && <button className="header-action" onClick={() => setDispatchTargetsOpen(true)} aria-label="Dispatch targets"><Gauge /></button>}
        <button className="header-action notification-bell" onClick={() => { setNotificationOpen((open) => !open); if (!notificationOpen) void refreshNotifications(); }} aria-label={`Notifications${unreadNotifications ? `, ${unreadNotifications} unread` : ""}`}><Bell />{unreadNotifications > 0 && <span className="notification-count">{unreadNotifications > 99 ? "99+" : unreadNotifications}</span>}</button>
        <button className="header-action" onClick={() => navigate("account")} aria-label="Settings"><SettingsIcon /></button>
      </header>
      <main className="app-main">
        {syncNotice && <p className="sync-notice" role="status">{syncNotice}</p>}
        {foregroundNotification && <aside className="foreground-notice" role="status"><span>{foregroundNotification.message || "You have a new update."}</span><button type="button" onClick={() => { const notification = foregroundNotification; setForegroundNotification(null); if (notification.target_type === "order" || notification.target_type === "order-pending") { if (notification.target_type === "order-pending") setOrderStatus("pending"); setPage("history"); } else if (notification.target_type === "job") setPage(role === "ADMIN" ? "jobs" : "home"); }} aria-label="Open notification">Open</button><button type="button" onClick={() => setForegroundNotification(null)} aria-label="Dismiss notification"><X aria-hidden="true" /></button></aside>}
        {page === "home" && role === "REP" && <RepHome orders={history} accounts={accounts} />}
        {page === "quote" && role !== "STOREKEEPER" && (
          <section className="quote-page">
            <h1 className="page-title"><FileText aria-hidden="true" /> New Order</h1>
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
            <ItemsTable key={`items-${formResetKey}`} products={ps.filter((product) => Boolean(product.active))} items={its} setItems={setIts} role={role} unavailableProductIds={unavailableItems.map((item) => item.p.id)} onPickerOpen={() => { setItemPickerOpen(true); void refreshProductsQuietly().catch(() => setSyncNotice("Offline — product list may be outdated.")); }} onPickerVisibilityChange={setItemPickerOpen} onQuantityValidityChange={setQuantityInvalid} validationAttempt={quantityValidationAttempt} />
            <div className="quote-total">
              <span>Total</span>
              <strong>{fmt(total)}</strong>
              <button className="primary preview-order-button" aria-label="Preview" onClick={(event) => { dialogTrigger.current = event.currentTarget; previewOrder(); }} disabled={saving}>
                {saving ? "Saving…" : "Review & Save"}
              </button>
            </div>
            {err && <p className="error">{err}</p>}
          </section>
        )}
        {page === "dashboard" && role === "STOREKEEPER" && (
          <section className="list-page storekeeper-dashboard">
            <h1 className="page-title"><History aria-hidden="true" /> Dashboard</h1>
            <button type="button" className="dispatch-summary pending-summary" onClick={() => { setOrderStatus("pending"); setPage("history"); }}><span>Pending orders</span><strong>{statusCounts.pending}</strong></button>
            <button type="button" className="dispatch-summary dispatched-summary" onClick={() => { setOrderStatus("dispatched"); setPage("history"); }}><span>Dispatched orders</span><strong>{statusCounts.dispatched}</strong></button>
          </section>
        )}
        {page === "history" && (
          <section className="list-page">
            <h1 className="page-title"><History aria-hidden="true" /> Orders</h1>
            <label className="history-search">
              {role === "STOREKEEPER" ? "Search by order, buyer, or address" : role === "ADMIN" ? "Search by buyer, phone, order, or Rep" : "Search by buyer name or phone"}
              <div>
                <input
                  type="search"
                  placeholder={role === "STOREKEEPER" ? "Order reference, buyer, or address" : role === "ADMIN" ? "Buyer, phone, order, or Rep username" : "Buyer name, phone, or order number"}
                  value={historyQuery}
                  onChange={(event) => setHistoryQuery(event.target.value)}
                />
                {historyQuery && <button type="button" onClick={() => setHistoryQuery("")}>Clear search</button>}
              </div>
            </label>
            <div className="account-tabs dispatch-tabs" aria-label="Order status"><button type="button" className={orderStatus === "all" ? "active" : ""} onClick={() => setOrderStatus("all")}>All</button><button type="button" className={orderStatus === "pending" ? "active" : ""} onClick={() => setOrderStatus("pending")}>Pending</button><button type="button" className={orderStatus === "dispatched" ? "active" : ""} onClick={() => setOrderStatus("dispatched")}>Dispatched</button><button type="button" className={orderStatus === "cancelled" ? "active" : ""} onClick={() => setOrderStatus("cancelled")}>Cancelled</button></div>
            {historyLoading && <p>Loading orders…</p>}
            {historyError && <p className="error">{historyError}</p>}
            {!historyLoading && !historyError && !history.length && <p>No orders found.</p>}
            {history.map((h) => (
              <article className={`history-card order-history-card${h.hidden_at ? " order-hidden" : ""}${h.cancelled_at ? " order-cancelled" : h.dispatched_at ? " order-dispatched" : " order-pending"}`} key={h.id}>
                <button type="button" className="order-card-open" onClick={(event) => openOrder(h.id, event.currentTarget)} aria-label={`Open order for ${h.buyer_name}`}>
                  <span className="order-card-content">
                    <span className="order-card-heading">
                      <strong>{h.buyer_name}</strong>
                    </span>
                    {role === "STOREKEEPER" && <small>{h.buyer_address || "No address"}</small>}
                    {h.dispatched_at && h.dispatcher_username && <small>Dispatched by {h.dispatcher_username}</small>}
                    {role === "STOREKEEPER" && h.creator_username && <small>Created by {h.creator_username}</small>}
                    {role === "ADMIN" && h.creator_username && <small>Created by {h.creator_username}</small>}
                    {role === "ADMIN" && h.hidden_at && <span className="status-badge status-hidden">Hidden</span>}
                    {role !== "STOREKEEPER" && <span className={`status-badge ${h.cancelled_at ? "status-danger" : h.dispatched_at ? "status-active" : "status-pending"}`}>{h.cancelled_at ? "Cancelled" : h.dispatched_at ? "Dispatched" : "Pending"}</span>}
                  </span>
                  <span className="order-card-summary">
                    <small className="order-card-date">{formatOrderDateTime(h.created_at)}</small>
                    {role === "STOREKEEPER" ? <span className={`status-badge ${h.cancelled_at ? "status-danger" : h.dispatched_at ? "status-active" : "status-pending"}`}>{h.cancelled_at ? "Cancelled" : h.dispatched_at ? "Dispatched" : "Pending"}</span> : <b>{fmt(h.total_minor)}</b>}
                  </span>
                  <ChevronRight aria-hidden="true" />
                </button>
                {role === "ADMIN" && <div className="order-card-actions">
                  <button type="button" className={`icon-action ${h.hidden_at ? "action-success" : "action-neutral"}`} aria-label={`${h.hidden_at ? "Unhide" : "Hide"} order for ${h.buyer_name}`} title={h.hidden_at ? "Unhide order" : "Hide order"} onClick={async (event) => { event.stopPropagation(); try { const updated = await api<any>(`/api/quotations/${h.id}/visibility`, { method: "PUT", body: JSON.stringify({ hidden: !h.hidden_at }) }); setHistory((current) => current.map((order) => order.id === h.id ? { ...order, hidden_at: updated.hidden_at } : order)); } catch (error) { setHistoryError((error as Error).message); } }}>{h.hidden_at ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}</button>
                  <button type="button" className="icon-action action-danger" aria-label={`Delete order for ${h.buyer_name}`} title="Delete order" onClick={async (event) => { event.stopPropagation(); const reference = orderReference(h); if (!window.confirm(`Delete order ${reference} for ${h.buyer_name}? This cannot be undone through the app.`)) return; try { await api(`/api/quotations/${h.id}`, { method: "DELETE" }); setHistory((current) => current.filter((order) => order.id !== h.id)); } catch (error) { setHistoryError((error as Error).message); } }}><Trash2 aria-hidden="true" /></button>
                </div>}
              </article>
            ))}
          </section>
        )}
        {page === "products" && (
          <section className="list-page">
            <div className="section-heading"><h1 className="page-title"><Package aria-hidden="true" /> Products</h1>{role === "ADMIN" && <button type="button" className="add-row" onClick={() => setProductForm(null)}><Plus aria-hidden="true" /> Add product</button>}</div>
            {productForm !== undefined && <ProductForm product={productForm} cancel={() => setProductForm(undefined)} complete={(product) => { setProductForm(undefined); setProductResults((current) => productForm ? current.map((item) => item.id === product.id ? product : item) : [product, ...current]); setPs((current) => productForm ? current.map((item) => item.id === product.id ? product : item) : [...current, product]); }} />}
            {productForm === undefined && <label className="history-search">
              Search products
              <div>
                <input type="search" placeholder="Brand, model, or SKU" value={productQuery} onChange={(event) => setProductQuery(event.target.value)} />
                {productQuery && <button type="button" onClick={() => setProductQuery("")}>Clear search</button>}
              </div>
            </label>}
            {productLoading && <p>Loading products…</p>}
            {productError && <p className="error">{productError}</p>}
            {!productLoading && !productError && !productResults.length && <p>No products found.</p>}
            {productForm === undefined && <div className="product-card-list">{productResults.map((p) => (
              <article className="product-card" key={p.id}>
                <div className="product-card-heading">
                  <div><h2>{productName(p)}</h2></div>
                  <span className={`status-badge ${p.active ? "status-active" : "status-hidden"}`}>{p.active ? "Active" : "Hidden"}</span>
                </div>
                <strong className="product-card-price">{fmt(p.price_minor)}</strong>
                {role === "ADMIN" && <div className="product-card-actions">
                  <button type="button" className="icon-action action-edit" aria-label={`Edit ${productName(p)}`} title="Edit product" onClick={() => setProductForm(p)}><Pencil aria-hidden="true" /></button>
                  <button type="button" className={`icon-action ${p.active ? "action-neutral" : "action-success"}`} aria-label={`${p.active ? "Hide" : "Unhide"} ${productName(p)}`} title={p.active ? "Hide product" : "Unhide product"} onClick={async () => { try { await api(`/api/products/${p.id}`, { method: "PUT", body: JSON.stringify({ ...p, active: p.active ? 0 : 1 }) }); setProductResults((current) => current.map((item) => item.id === p.id ? { ...item, active: p.active ? 0 : 1 } : item)); setPs((current) => current.map((item) => item.id === p.id ? { ...item, active: p.active ? 0 : 1 } : item)); } catch (error) { setProductError((error as Error).message); } }}>{p.active ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}</button>
                  <button type="button" className="icon-action action-danger" aria-label={`Delete ${productName(p)}`} title="Delete product" onClick={async () => { if (!window.confirm(`Delete ${productName(p)}?`)) return; try { const result = await api<{ hidden?: boolean }>(`/api/products/${p.id}`, { method: "DELETE" }); if (result.hidden) { setProductResults((current) => current.map((item) => item.id === p.id ? { ...item, active: 0 } : item)); setPs((current) => current.map((item) => item.id === p.id ? { ...item, active: 0 } : item)); } else { setProductResults((current) => current.filter((item) => item.id !== p.id)); setPs((current) => current.filter((item) => item.id !== p.id)); } } catch (error) { setProductError((error as Error).message); } }}><Trash2 aria-hidden="true" /></button>
                </div>}
              </article>
            ))}</div>}
          </section>
        )}
        {page === "jobs" && role === "ADMIN" && <JobsPanel role="ADMIN" accounts={accounts} />}
        {page === "buyers" && (
          <section className="list-page">
            <div className="section-heading"><h1 className="page-title"><Users aria-hidden="true" /> Buyers</h1><button type="button" className="add-row" onClick={() => setBuyerForm(null)}><Plus aria-hidden="true" /> Add buyer</button></div>
            {buyerForm !== undefined && <BuyerForm buyer={buyerForm} onDirtyChange={setBuyerFormDirty} cancel={() => { setBuyerFormDirty(false); setBuyerForm(undefined); }} complete={async buyer => { await refreshBuyers(); setBuyerFormDirty(false); setBuyerForm(undefined); setB(buyer); setPage("quote"); }} />}
            {buyerForm === undefined && <label className="history-search">
              Search buyers
              <div>
                <input type="search" placeholder="Buyer name, address, or phone" value={buyerQuery} onChange={(event) => setBuyerQuery(event.target.value)} />
                {buyerQuery && <button type="button" onClick={() => setBuyerQuery("")}>Clear search</button>}
              </div>
            </label>}
            {buyerLoading && <p>Loading buyers…</p>}
            {buyerError && <p className="error">{buyerError}</p>}
            {!buyerLoading && !buyerError && !buyerResults.length && <p>No buyers found.</p>}
            {buyerForm === undefined && buyerResults.map((x) => (
              <article className="history-card" key={x.id}>
                <span>{x.full_name}<small>{x.address || "No address"}</small></span>
                <button type="button" className="buyer-edit-action" aria-label={`Edit ${x.full_name}`} title="Edit buyer" onClick={() => setBuyerForm(x)}><Pencil aria-hidden="true" /></button>
              </article>
            ))}
          </section>
        )}
        {page === "account" && (
          <section className="list-page account-page">
            <h1 className="page-title"><SettingsIcon aria-hidden="true" /> Settings</h1>
            <p>{username} · {role}</p>
            <nav className="account-tabs" aria-label="Settings sections">
              <button type="button" className={accountSection === "profile" ? "active" : ""} onClick={() => setAccountSection("profile")}>Profile</button>
              {role === "ADMIN" && <button type="button" className={accountSection === "pdf" ? "active" : ""} onClick={() => setAccountSection("pdf")}>PDF header</button>}
              {role === "ADMIN" && <button type="button" className={accountSection === "team" ? "active" : ""} onClick={() => setAccountSection("team")}>Accounts</button>}
            </nav>
            {accountError && <p className="error">{accountError}</p>}
            {accountNotice && <p className="success">{accountNotice}</p>}
            {accountSection === "profile" && <form className="inline-form" onSubmit={async (event) => { event.preventDefault(); setAccountError(""); try { await api("/api/account/password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) }); setCurrentPassword(""); setNewPassword(""); location.reload(); } catch (error) { setAccountError((error as Error).message); } }}>
              <h2>Change password</h2>
              <label>Current password<input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
              <label>New password<input type="password" minLength={1} maxLength={256} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
              <div className="form-footer form-footer-right"><button className="primary account-submit">Update password</button></div>
            </form>}
            {accountSection === "profile" && <PhoneNotificationControls />}
            {accountSection === "profile" && <section className="account-signout" aria-label="Sign out">
              <div><h2>Sign out</h2><p>Sign out of this device and disconnect its phone-notification subscription.</p></div>
              <button type="button" className="account-signout-button" onClick={() => void logout()}><LogOut aria-hidden="true" /> Log out</button>
            </section>}
            {role === "ADMIN" && <>
              {accountSection === "pdf" && pdfHeader && <form className="inline-form" onSubmit={async (event) => { event.preventDefault(); setAccountError(""); setAccountNotice(""); setPdfHeaderBusy(true); try { const savedHeader = await api<Settings>("/api/settings/pdf-header", { method: "PUT", body: JSON.stringify({ shop_name: pdfHeader.shop_name, address: pdfHeader.address, phone: pdfHeader.phone, document_title: pdfHeader.pdf_document_title }) }); setPdfHeader(savedHeader); setAccountNotice("PDF header saved. It will be used for new orders; existing saved orders keep their header."); } catch (error) { setAccountError((error as Error).message); } finally { setPdfHeaderBusy(false); } }}>
                <h2>PDF Header</h2>
                <label>Shop/company name<input required maxLength={120} value={pdfHeader.shop_name} onChange={(event) => setPdfHeader({ ...pdfHeader, shop_name: event.target.value })} /></label>
                <label>Address<textarea required maxLength={500} value={pdfHeader.address} onChange={(event) => setPdfHeader({ ...pdfHeader, address: event.target.value })} /></label>
                <label>Phone<input required maxLength={60} value={pdfHeader.phone} onChange={(event) => setPdfHeader({ ...pdfHeader, phone: event.target.value })} /></label>
                <label>Document title<input required maxLength={120} value={pdfHeader.pdf_document_title || "Purchase Order"} onChange={(event) => setPdfHeader({ ...pdfHeader, pdf_document_title: event.target.value })} /></label>
                <div className="pdf-header-preview" aria-label="PDF header preview"><strong>{pdfHeader.shop_name || "Shop name"}</strong><span>{pdfHeader.address || "Address"}</span><span>{pdfHeader.phone || "Phone"}</span><b>{pdfHeader.pdf_document_title || "Purchase Order"}</b></div>
                <div className="form-footer form-footer-right"><button className="primary account-submit" disabled={pdfHeaderBusy}>{pdfHeaderBusy ? "Saving…" : "Save PDF header"}</button></div>
              </form>}
              {accountSection === "team" && <><form className="inline-form" onSubmit={async (event) => { event.preventDefault(); setAccountError(""); try { await api("/api/accounts", { method: "POST", body: JSON.stringify({ username: accountUsername, password: accountPassword, role: accountRole }) }); setAccountUsername(""); setAccountPassword(""); setAccountRole("REP"); refreshAccounts(); } catch (error) { setAccountError((error as Error).message); } }}>
                <h2>Create account</h2>
                <label>Username<input value={accountUsername} onChange={(event) => setAccountUsername(event.target.value)} /></label>
                <label>Password<input type="password" minLength={1} maxLength={256} value={accountPassword} onChange={(event) => setAccountPassword(event.target.value)} /></label>
                <label>Role<select value={accountRole} onChange={(event) => setAccountRole(event.target.value as "REP" | "STOREKEEPER")}><option value="REP">Rep</option><option value="STOREKEEPER">Storekeeper</option></select></label>
                <div className="form-footer form-footer-right"><button className="primary account-submit">Create {accountRole === "REP" ? "Rep" : "Storekeeper"}</button></div>
              </form>
              <h2>Accounts</h2>
              <div className="account-card-list">{accounts.map((account) => <article className="account-card" key={account.id}><div><strong>{account.username}</strong><small>{account.role}</small></div><span className={`status-badge ${account.active ? "status-active" : "status-hidden"}`}>{account.active ? "Active" : "Inactive"}</span><div className="account-card-actions"><button type="button" className={account.active ? "action-neutral" : "action-success"} disabled={account.id === 1 && account.active} onClick={async () => { setAccountError(""); setAccountNotice(""); try { await api(`/api/accounts/${account.id}`, { method: "PUT", body: JSON.stringify({ active: account.active ? 0 : 1 }) }); setAccountNotice(`${account.username} ${account.active ? "deactivated" : "activated"}.`); refreshAccounts(); } catch (error) { setAccountError((error as Error).message); } }}>{account.active ? "Deactivate" : "Activate"}</button><button type="button" onClick={async () => { const value = window.prompt(`New password for ${account.username}`); if (value === null) return; setAccountError(""); setAccountNotice(""); try { await api(`/api/accounts/${account.id}/reset-password`, { method: "POST", body: JSON.stringify({ password: value }) }); setAccountNotice(`Password reset for ${account.username}.`); } catch (error) { setAccountError((error as Error).message); } }}>Reset password</button>{account.role !== "ADMIN" && <button type="button" className="action-danger" disabled={deletingAccountId === account.id} onClick={async () => { if (!window.confirm(`Delete ${account.role === "STOREKEEPER" ? "Storekeeper" : "Rep"} ${account.username}? Their orders will be retained.`)) return; setDeletingAccountId(account.id); setAccountError(""); setAccountNotice(""); try { await api(`/api/accounts/${account.id}`, { method: "DELETE" }); await refreshAccounts(); setAccountNotice(`${account.username} deleted.`); } catch (error) { setAccountError((error as Error).message); } finally { setDeletingAccountId(null); } }}>{deletingAccountId === account.id ? "Deleting…" : `Delete ${account.role === "STOREKEEPER" ? "Storekeeper" : "Rep"}`}</button>}</div></article>)}</div>
            </>}</>}
          </section>
        )}
        {draftPreview && (
          <div className="modal-backdrop" onClick={() => setDraftPreview(null)}>
            <section className="quote-dialog draft-preview-dialog" role="dialog" aria-modal="true" aria-label="Order preview" onClick={(event) => event.stopPropagation()}>
              <button type="button" className="dialog-close" onClick={() => setDraftPreview(null)} aria-label="Close preview"><X aria-hidden="true" /></button>
              <h1>Order preview</h1>
              <OrderDocumentPreview q={draftPreview} header={pdfHeader} />
              {err && <p className="error">{err}</p>}
              <div className="form-footer"><button type="button" onClick={() => setDraftPreview(null)}>Edit</button><button type="button" className="primary" disabled={saving} onClick={confirmSave}>{saving ? "Saving" : "Confirm"}</button></div>
            </section>
          </div>
        )}
        {dispatchDetail && (
          <div className="modal-backdrop" onClick={() => setDispatchDetail(null)}>
            <section className="quote-dialog dispatch-dialog" role="dialog" aria-modal="true" aria-label="Dispatch order" onClick={(event) => event.stopPropagation()}>
              <button type="button" className="dialog-close" onClick={() => setDispatchDetail(null)} aria-label="Close order"><X aria-hidden="true" /></button>
              <h1>Dispatch order</h1>
              <p><strong>{orderReference(dispatchDetail)}</strong></p>
              <p>{dispatchDetail.buyer_name}<br /><span className="preserve-lines">{dispatchDetail.buyer_address}</span>{dispatchDetail.buyer_phone && <><br />{dispatchDetail.buyer_phone}</>}<br /><small>{formatOrderDateTime(dispatchDetail.created_at)} · Created by {dispatchDetail.creator_username || "Unknown"}</small></p>
              <h2>Packing checklist</h2>
              <div className="dispatch-checklist">{dispatchDetail.items.map((item: any) => <label key={item.product_id}><input type="checkbox" checked={Boolean(item.packing_checked)} disabled={Boolean(dispatchDetail.dispatched_at || dispatchDetail.cancelled_at) || dispatchBusy} onChange={(event) => savePacking(dispatchDetail.items.map((current: any) => current.product_id === item.product_id ? { ...current, packing_checked: event.target.checked ? 1 : 0 } : current))} /><span><strong>{item.item_name}</strong><small>Quantity: {item.quantity}</small></span></label>)}</div>
              {dispatchDetail.cancelled_at ? <p className="error">Cancelled by {dispatchDetail.canceller_username}: {dispatchDetail.cancellation_reason}</p> : dispatchDetail.dispatched_at ? <p className="success">Dispatched {formatOrderDateTime(dispatchDetail.dispatched_at)} by {dispatchDetail.dispatcher_username}</p> : <><label>Dispatch notes<textarea value={dispatchNotes} onChange={(event) => setDispatchNotes(event.target.value)} maxLength={2000} /></label><label>Delivery/reference number (optional)<input value={deliveryReference} onChange={(event) => setDeliveryReference(event.target.value)} maxLength={200} /></label><div className="form-footer form-footer-right"><button type="button" className="primary" disabled={dispatchBusy} onClick={markDispatched}>{dispatchBusy ? "Saving…" : "Mark as dispatched"}</button></div></>}
            </section>
          </div>
        )}
        {saved && (
          <div className="modal-backdrop" onClick={closeSavedOrder}>
            <section className="quote-dialog saved-order-dialog" role="dialog" aria-modal="true" aria-label="Saved order" onClick={(event) => event.stopPropagation()}>
              <button type="button" className="dialog-close" onClick={closeSavedOrder} aria-label="Close">
                <X aria-hidden="true" />
              </button>
              <h1>{saved.quotation_number}</h1>
              <p>
                {saved.buyer_name} · {fmt(saved.total_minor)}
              </p>
              {(saved as any).dispatched_at && <p className="success">Dispatched {formatOrderDateTime((saved as any).dispatched_at)} by {(saved as any).dispatcher_username || "Unknown"}</p>}
              {(saved as any).cancelled_at && <p className="error">Cancelled by {(saved as any).canceller_username || "Unknown"}: {(saved as any).cancellation_reason}</p>}
              <PDF q={saved} header={pdfHeader} onUnavailable={() => { setSaved(null); setSavedMode(null); setHistoryError("This order is no longer available."); }} />
              {role === "ADMIN" && (saved as any).dispatched_at && <button type="button" className="action-neutral order-management-action return-order-action" onClick={async () => { const reason = window.prompt("Reason for returning this order to pending dispatch:"); if (!reason?.trim()) return; try { const updated = await api<Quotation>(`/api/quotations/${saved.id}/return-to-pending`, { method: "POST", body: JSON.stringify({ reason }) }); setSaved(updated); setHistory((current) => current.map((order) => order.id === updated.id ? { ...order, dispatched_at: null, dispatcher_username: null } : order)); } catch (error) { setHistoryError((error as Error).message); } }}>Return to pending</button>}
              {role === "ADMIN" && !(saved as any).dispatched_at && !(saved as any).cancelled_at && <button type="button" className="action-danger order-management-action cancel-order-action" onClick={async () => { const reason = window.prompt(`Reason for cancelling ${orderReference(saved)}:`); if (!reason?.trim()) return; if (!window.confirm(`Cancel ${orderReference(saved)} for ${saved.buyer_name}?`)) return; try { const updated = await api<Quotation>(`/api/quotations/${saved.id}/cancel`, { method: "POST", body: JSON.stringify({ reason }) }); setSaved(updated); setHistory((current) => current.map((order) => order.id === updated.id ? { ...order, cancelled_at: (updated as any).cancelled_at, canceller_username: (updated as any).canceller_username } : order)); } catch (error) { setHistoryError((error as Error).message); } }}>Cancel order</button>}
            </section>
          </div>
        )}
      </main>
      {notificationOpen && <div className="quote-dialog-backdrop notification-backdrop" onClick={() => setNotificationOpen(false)}><section className="quote-dialog notification-panel" role="dialog" aria-modal="true" aria-label="Notifications" onClick={(event) => event.stopPropagation()}><button type="button" className="dialog-close" aria-label="Close notifications" onClick={() => setNotificationOpen(false)}><X aria-hidden="true" /></button><div className="section-heading"><h2>Notifications</h2><button type="button" className="mark-all-read" disabled={!unreadNotifications} onClick={async () => { await api("/api/notifications/read-all", { method: "PUT" }); await refreshNotifications(); }}><CheckCheck aria-hidden="true" /> Mark all read</button></div>{notificationError && <p className="error">{notificationError}</p>}{!notifications.length && <p className="empty-state">No notifications yet.</p>}<div className="notification-list">{notifications.map((notification) => <button type="button" key={notification.id} className={`notification-row${notification.read_at ? "" : " unread"}`} onClick={async () => { await api(`/api/notifications/${notification.id}/read`, { method: "PUT" }); setNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, read_at: new Date().toISOString() } : item)); setUnreadNotifications((count) => notification.read_at ? count : Math.max(0, count - 1)); setNotificationOpen(false); if (notification.target_type === "order" || notification.target_type === "order-pending") { if (notification.target_type === "order-pending") setOrderStatus("pending"); setPage("history"); } else if (notification.target_type === "job") setPage(role === "ADMIN" ? "jobs" : "home"); }}><Bell aria-hidden="true" /><span><strong>{notification.message}</strong><small>{formatOrderDateTime(notification.created_at)}</small></span></button>)}</div>{notificationsNext && <button type="button" className="add-row" onClick={() => void refreshNotifications(notificationsNext)}>Load older</button>}</section></div>}
      {dispatchTargetsOpen && role === "ADMIN" && <DispatchTargetsDialog close={() => setDispatchTargetsOpen(false)} />}
      <nav className="bottom-nav">
        {(role === "STOREKEEPER" ? [
          ["dashboard", "Dashboard", History],
          ["history", "Orders", History],
          ["account", "Account", SettingsIcon],
        ] : role === "ADMIN" ? [
          ["quote", "New Order", FileText],
          ["history", "Orders", History],
          ["products", "Products", Package],
          ["buyers", "Buyers", Users],
          ["jobs", "Jobs", BriefcaseBusiness],
        ] : [
          ["home", "Home", BriefcaseBusiness],
          ["quote", "New Order", FileText],
          ["history", "Orders", History],
          ["products", "Products", Package],
          ["buyers", "Buyers", Users],
        ]).map(([id, l, I]: any) => (
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
          <img className="login-wordmark" src="/rsk-holdings-wordmark.png" alt="RSK Holdings (PVT) LTD" />
          <div><h1>Welcome back</h1><p>Sign in to manage orders.</p></div>
        </div>
        <form
          onSubmit={async (x) => {
            x.preventDefault();
            setE("");
            setLoading(true);
            try {
              const controller = new AbortController();
              const timer = window.setTimeout(() => controller.abort(), 15000);
              await api("/api/login", {
                method: "POST",
                body: JSON.stringify({ username: u, password: p }),
                signal: controller.signal,
              });
              window.clearTimeout(timer);
              location.reload();
            } catch (x) {
              setE((x as Error).name === "AbortError" ? "Login is taking too long. Check the local Worker connection and try again." : (x as Error).message);
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
