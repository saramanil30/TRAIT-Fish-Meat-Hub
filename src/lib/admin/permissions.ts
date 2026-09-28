export const staffRoles = ["ADMIN", "OWNER", "EMPLOYEE"] as const;
export type StaffRole = typeof staffRoles[number];
export const staffSections = ["dashboard", "orders", "catalogue", "categories", "prices", "employees", "payments", "reports", "settings"] as const;
export type StaffSection = typeof staffSections[number];
export function canAccessSection(role: StaffRole, section: StaffSection): boolean {
  if (role === "ADMIN") return true;
  if (role === "OWNER") return section !== "catalogue" && section !== "categories";
  return role === "EMPLOYEE" && (section === "dashboard" || section === "orders");
}
export function canManageDailyProducts(role: StaffRole) { return role === "ADMIN" || role === "OWNER"; }
export function canManageCatalogue(role: StaffRole) { return role === "ADMIN"; }
export function parseDailyPrice(value: string): number {
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(value)) throw new Error("Enter a price with at most two decimal places.");
  const paise = Math.round(Number(value) * 100);
  if (!Number.isSafeInteger(paise) || paise < 1 || paise > 100000000) throw new Error("Price must be between ₹0.01 and ₹1,000,000 per kg.");
  return paise;
}
