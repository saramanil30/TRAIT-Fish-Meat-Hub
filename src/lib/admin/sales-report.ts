// Sales report model shared by the Reports page and its Excel export, so both always show the same numbers.
export type SalesReport = {
 from: string; until: string;
 summary: { orders: number; revenuePaise: number; discountPaise: number; deliveryFeePaise: number; cancelled: number; cancelledPaise: number };
 daily: { day: string; orders: number; revenuePaise: number }[];
 products: { name: string; category: string; grams: number; packs: number; trays: boolean; orders: number; revenuePaise: number }[];
 categories: { name: string; grams: number; packs: number; orders: number; revenuePaise: number }[];
 payments: { method: string; orders: number; collectedPaise: number; pendingPaise: number; refundedPaise: number }[];
 fulfilment: { method: string; orders: number; revenuePaise: number; deliveryFeePaise: number }[];
 coupons: { code: string | null; title: string | null; uses: number; discountPaise: number; revenuePaise: number }[];
 cancellations: { orderNumber: string; placedAt: string; cancelledAt: string; amountPaise: number; reason: string | null; by: string; role: string }[];
 cash: { day: string; staff: string; collections: number; receivedPaise: number; refundedPaise: number }[];
};

export const reportRanges = ["today", "yesterday", "week", "month", "last-month", "custom"] as const;
export type ReportRange = typeof reportRanges[number];
export const rangeLabels: Record<ReportRange, string> = { today: "Today", yesterday: "Yesterday", week: "This week", month: "This month", "last-month": "Last month", custom: "Custom" };
export const reportTabs = ["products", "categories", "payments", "fulfilment", "coupons", "cancellations", "cash"] as const;
export type ReportTab = typeof reportTabs[number];
export const tabLabels: Record<ReportTab, string> = { products: "By product", categories: "By category", payments: "Payments", fulfilment: "Delivery vs pickup", coupons: "Coupons", cancellations: "Cancellations", cash: "Day-end cash" };

const DAY = 86400000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dayMs = (day: string) => Date.parse(day + "T00:00:00Z");
/** Today's calendar date in India, as YYYY-MM-DD. */
export function istToday(now = new Date()) { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(now); }
const validDay = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && isoDay(dayMs(v)) === v;

export type ReportPeriod = { range: ReportRange; from: string; until: string; error?: string };
/** Presets in IST with both ends inclusive; weeks start on Monday. Custom ranges allow at most 366 days. */
export function resolvePeriod(range?: string, from?: string, until?: string, now = new Date()): ReportPeriod {
 const today = istToday(now), t = dayMs(today), d = new Date(t);
 const monthStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
 switch (range) {
  case "yesterday": return { range, from: isoDay(t - DAY), until: isoDay(t - DAY) };
  case "week": return { range, from: isoDay(t - ((d.getUTCDay() + 6) % 7) * DAY), until: today };
  case "month": return { range, from: isoDay(monthStart), until: today };
  case "last-month": return { range, from: isoDay(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)), until: isoDay(monthStart - DAY) };
  case "custom": {
   if (!validDay(from) || !validDay(until)) return { range: "today", from: today, until: today, error: "Choose both a start and an end date." };
   if (from! > until!) return { range: "today", from: today, until: today, error: "The start date must be on or before the end date." };
   if (dayMs(until!) - dayMs(from!) > 365 * DAY) return { range: "today", from: today, until: today, error: "Choose a range of at most 366 days." };
   return { range, from: from!, until: until! };
  }
  default: return { range: "today", from: today, until: today };
 }
}
const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "9 Oct 2026" from YYYY-MM-DD. */
export function dayLabel(day: string) { const [y, m, d] = day.split("-").map(Number); return d + " " + monthNames[m - 1] + " " + y; }
export function periodLabel(p: { from: string; until: string }) { return p.from === p.until ? dayLabel(p.from) : dayLabel(p.from) + " – " + dayLabel(p.until); }

/** text; int; money (paise); pct (fraction); kg (grams); day (YYYY-MM-DD); time (ISO instant, shown in IST). */
export type ColumnKind = "text" | "int" | "money" | "pct" | "kg" | "day" | "time";
export type Cell = string | number | null;
export type ReportTable = { title: string; columns: { label: string; kind: ColumnKind }[]; rows: Cell[][]; total?: Cell[] };
const methodLabel: Record<string, string> = { CASH: "Cash", UPI: "UPI", ONLINE: "Online", HOME_DELIVERY: "Delivery", STORE_PICKUP: "Pickup" };
const roleLabel: Record<string, string> = { ADMIN: "Admin", OWNER: "Owner", EMPLOYEE: "Employee", CHECKOUT: "Customer" };
const share = (part: number, whole: number) => whole ? part / whole : 0;
const sum = <T,>(rows: T[], pick: (r: T) => number) => rows.reduce((s, r) => s + Number(pick(r)), 0);
const orBlank = (n: number) => Number(n) ? Number(n) : null;

export function summaryRows(r: SalesReport): [string, Cell, ColumnKind][] {
 const s = r.summary, orders = Number(s.orders), revenue = Number(s.revenuePaise);
 return [["Orders", orders, "int"], ["Revenue (excludes cancelled)", revenue, "money"], ["Average order", orders ? Math.round(revenue / orders) : 0, "money"],
  ["Discounts", Number(s.discountPaise), "money"], ["Delivery fees", Number(s.deliveryFeePaise), "money"], ["Cancelled orders", Number(s.cancelled), "int"], ["Cancelled value", Number(s.cancelledPaise), "money"]];
}
export function dailyTable(r: SalesReport): ReportTable {
 return { title: "Daily trend", columns: [{ label: "Date", kind: "day" }, { label: "Orders", kind: "int" }, { label: "Revenue", kind: "money" }],
  rows: r.daily.map(d => [d.day, Number(d.orders), Number(d.revenuePaise)]), total: ["Total", sum(r.daily, d => d.orders), sum(r.daily, d => d.revenuePaise)] };
}
export function tabTables(r: SalesReport, tab: ReportTab): ReportTable[] {
 switch (tab) {
  case "products": case "categories": {
   const rows = tab === "products" ? r.products : r.categories, total = sum(rows, p => p.revenuePaise);
   const first = tab === "products" ? [{ label: "Product", kind: "text" as const }, { label: "Category", kind: "text" as const }] : [{ label: "Category", kind: "text" as const }];
   return [{ title: tabLabels[tab], columns: [...first, { label: "Kg", kind: "kg" }, { label: "Trays / units", kind: "int" }, { label: "Orders", kind: "int" }, { label: "Item sales", kind: "money" }, { label: "Share", kind: "pct" }],
    rows: rows.map((p): Cell[] => [p.name, ...(tab === "products" ? [(p as SalesReport["products"][number]).category] : []), orBlank(p.grams), orBlank(p.packs), Number(p.orders), Number(p.revenuePaise), share(Number(p.revenuePaise), total)]),
    total: ["Total", ...(tab === "products" ? [null] : []), orBlank(sum(rows, p => p.grams)), orBlank(sum(rows, p => p.packs)), null, total, rows.length ? 1 : 0] }];
  }
  case "payments": return [{ title: "Payments", columns: [{ label: "Method", kind: "text" }, { label: "Orders", kind: "int" }, { label: "Collected", kind: "money" }, { label: "Pending", kind: "money" }, { label: "Refunded", kind: "money" }],
   rows: r.payments.map(p => [methodLabel[p.method] ?? p.method, Number(p.orders), Number(p.collectedPaise), Number(p.pendingPaise), Number(p.refundedPaise)]),
   total: ["Total", sum(r.payments, p => p.orders), sum(r.payments, p => p.collectedPaise), sum(r.payments, p => p.pendingPaise), sum(r.payments, p => p.refundedPaise)] }];
  case "fulfilment": { const total = sum(r.fulfilment, f => f.revenuePaise);
   return [{ title: "Delivery vs pickup", columns: [{ label: "Method", kind: "text" }, { label: "Orders", kind: "int" }, { label: "Revenue", kind: "money" }, { label: "Average order", kind: "money" }, { label: "Delivery fees", kind: "money" }, { label: "Share", kind: "pct" }],
    rows: r.fulfilment.map(f => [methodLabel[f.method] ?? f.method, Number(f.orders), Number(f.revenuePaise), Number(f.orders) ? Math.round(Number(f.revenuePaise) / Number(f.orders)) : 0, Number(f.deliveryFeePaise), share(Number(f.revenuePaise), total)]),
    total: ["Total", sum(r.fulfilment, f => f.orders), total, null, sum(r.fulfilment, f => f.deliveryFeePaise), r.fulfilment.length ? 1 : 0] }]; }
  case "coupons": return [{ title: "Coupons", columns: [{ label: "Code", kind: "text" }, { label: "Offer", kind: "text" }, { label: "Uses", kind: "int" }, { label: "Discount given", kind: "money" }, { label: "Order revenue", kind: "money" }],
   rows: r.coupons.map(c => [c.code ?? "Automatic", c.title ?? "", Number(c.uses), Number(c.discountPaise), Number(c.revenuePaise)]),
   total: ["Total", null, sum(r.coupons, c => c.uses), sum(r.coupons, c => c.discountPaise), sum(r.coupons, c => c.revenuePaise)] }];
  case "cancellations": return [{ title: "Cancellations", columns: [{ label: "Order", kind: "text" }, { label: "Placed", kind: "time" }, { label: "Cancelled", kind: "time" }, { label: "Amount", kind: "money" }, { label: "Reason", kind: "text" }, { label: "Cancelled by", kind: "text" }],
   rows: r.cancellations.map(c => [c.orderNumber, c.placedAt, c.cancelledAt, Number(c.amountPaise), c.reason ?? "", c.by + (roleLabel[c.role] ? " (" + roleLabel[c.role] + ")" : "")]),
   total: ["Total", null, null, sum(r.cancellations, c => c.amountPaise), r.cancellations.length + " cancelled", null] }];
  case "cash": {
   const days = [...new Set(r.cash.map(c => c.day))].map(day => { const rows = r.cash.filter(c => c.day === day); return { day, collections: sum(rows, c => c.collections), received: sum(rows, c => c.receivedPaise), refunded: sum(rows, c => c.refundedPaise) }; });
   const money = [{ label: "Cash received", kind: "money" as const }, { label: "Cash refunded", kind: "money" as const }, { label: "Net cash", kind: "money" as const }];
   return [
    { title: "Day-end cash by day", columns: [{ label: "Date", kind: "day" }, { label: "Collections", kind: "int" }, ...money],
     rows: days.map(d => [d.day, d.collections, d.received, d.refunded, d.received - d.refunded]),
     total: ["Total", sum(days, d => d.collections), sum(days, d => d.received), sum(days, d => d.refunded), sum(days, d => d.received - d.refunded)] },
    { title: "Day-end cash by staff member", columns: [{ label: "Date", kind: "day" }, { label: "Staff member", kind: "text" }, { label: "Collections", kind: "int" }, ...money],
     rows: r.cash.map(c => [c.day, c.staff, Number(c.collections), Number(c.receivedPaise), Number(c.refundedPaise), Number(c.receivedPaise) - Number(c.refundedPaise)]) },
   ];
  }
 }
}
