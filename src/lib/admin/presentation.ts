// Synthetic presentation fixtures only. Never use these as staff authorization or live records.
export type PreviewRole = "admin" | "owner" | "employee";
export const sections = ["dashboard", "orders", "catalogue", "categories", "prices", "employees", "payments", "reports", "settings"] as const;
export type Section = typeof sections[number];
export const sectionLabels: Record<Section, string> = { dashboard: "Dashboard", orders: "Orders", catalogue: "Catalogue", categories: "Categories", prices: "Prices & Availability", employees: "Employees", payments: "Payments", reports: "Reports", settings: "Settings" };
export const statuses = ["PLACED", "CONFIRMED", "PREPARING", "READY", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"] as const;
export type Status = typeof statuses[number];
export interface PreviewOrder { id: string; store: string; customer: string; method: "Delivery" | "Pickup"; status: Status; payment: "PENDING" | "VERIFYING" | "PAID" | "FAILED" | "REFUNDED"; tender: "Cash" | "Online / UPI"; product: string; preparation: string; grams: number; pricePaise: number; feePaise: number; time: string; history: string[]; dispatchGrams?: number; reference?: string }
export const previewOrders: PreviewOrder[] = [
  { id: "TFM-100241", store: "main", customer: "Sample customer A", method: "Delivery", status: "PLACED", payment: "PENDING", tender: "Cash", product: "Seer Fish", preparation: "Cleaned", grams: 1000, pricePaise: 98000, feePaise: 3000, time: "10:42", history: ["10:42 · System preview · Order placed"] },
  { id: "TFM-100240", store: "main", customer: "Sample customer B", method: "Pickup", status: "PREPARING", payment: "VERIFYING", tender: "Online / UPI", product: "Chicken Curry Cut", preparation: "Curry Cut", grams: 1500, pricePaise: 28000, feePaise: 0, time: "10:36", history: ["10:36 · System preview · Order placed", "10:40 · Sample owner · Preparing"] },
  { id: "TFM-100239", store: "main", customer: "Sample customer C", method: "Delivery", status: "READY", payment: "PAID", tender: "Online / UPI", product: "Mutton Curry Cut", preparation: "Curry Cut", grams: 1000, pricePaise: 89000, feePaise: 3000, time: "10:20", history: ["10:20 · System preview · Order placed", "10:38 · Sample owner · Ready"] },
  { id: "TFM-100238", store: "main", customer: "Sample customer D", method: "Pickup", status: "DELIVERED", payment: "PAID", tender: "Cash", product: "White Prawns", preparation: "Cleaned", grams: 500, pricePaise: 64000, feePaise: 0, time: "09:48", history: ["09:48 · System preview · Order placed", "10:10 · Sample owner · Collected"] },
  { id: "TFM-100237", store: "branch", customer: "Sample branch customer", method: "Delivery", status: "CONFIRMED", payment: "FAILED", tender: "Online / UPI", product: "Chicken Breast", preparation: "Boneless", grams: 1000, pricePaise: 42000, feePaise: 3000, time: "09:40", history: ["09:40 · System preview · Order placed"] },
  { id: "TFM-100236", store: "main", customer: "Sample customer E", method: "Delivery", status: "CANCELLED", payment: "REFUNDED", tender: "Online / UPI", product: "Seer Fish", preparation: "Fry Cut", grams: 500, pricePaise: 98000, feePaise: 3000, time: "09:30", history: ["09:30 · System preview · Order placed", "09:35 · Sample owner · Cancelled"] },
];
export function total(order: PreviewOrder) { return Math.round(order.pricePaise * order.grams / 1000) + order.feePaise; }
export function money(paise: number) { return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(paise / 100); }
export function visibleOrders(orders: PreviewOrder[], role: PreviewRole, store: string) { return orders.filter(order => role === "employee" ? order.store === "main" : store === "all" || order.store === store); }
export function nextStatus(order: PreviewOrder): Status | undefined {
  if (order.status === "READY") return order.method === "Pickup" ? "DELIVERED" : "OUT_FOR_DELIVERY";
  const next: Partial<Record<Status, Status>> = { PLACED: "CONFIRMED", CONFIRMED: "PREPARING", PREPARING: "READY", OUT_FOR_DELIVERY: "DELIVERED" };
  return next[order.status];
}
export function canPreviewSection(role: PreviewRole, section: Section) { return role === "admin" || (role === "owner" && section !== "catalogue" && section !== "categories") || (role === "employee" && section === "orders"); }
