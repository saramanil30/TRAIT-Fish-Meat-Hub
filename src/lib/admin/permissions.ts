export const staffRoles = ["ADMIN", "OWNER", "EMPLOYEE"] as const;
export type StaffRole = typeof staffRoles[number];
export const staffSections = ["dashboard", "orders", "catalogue", "categories", "prices", "offers", "employees", "payments", "reports", "settings"] as const;
export type StaffSection = typeof staffSections[number];
export function canAccessSection(role: StaffRole, section: StaffSection): boolean {
  if (role === "ADMIN") return true;
  if (role === "OWNER") return section !== "catalogue" && section !== "categories";
  return role === "EMPLOYEE" && (section === "dashboard" || section === "orders");
}
export function canManageDailyProducts(role: StaffRole) { return role === "ADMIN" || role === "OWNER"; }
export function canManageCatalogue(role: StaffRole) { return role === "ADMIN"; }
/** Admin money input in rupees (e.g. "50" or "49.50") to paise; up to ₹999,999,999.99. */
export function rupeesToPaise(value: string): number {
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(value.trim())) throw new Error("Enter an amount in rupees with at most two decimal places.");
  return Math.round(Number(value.trim()) * 100);
}
export function parseDailyPrice(value: string): number {
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(value)) throw new Error("Enter a price with at most two decimal places.");
  const paise = Math.round(Number(value) * 100);
  if (!Number.isSafeInteger(paise) || paise < 1 || paise > 100000000) throw new Error("Price must be between ₹0.01 and ₹1,000,000 per kg.");
  return paise;
}
