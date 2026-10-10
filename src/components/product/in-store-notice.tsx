import { IN_STORE_PHONE } from "@/lib/shop-categories";
/** Shown for a category with no products online yet. */
export function InStoreNotice({ category, children }: { category: string; children?: React.ReactNode }) {
  return <div className="empty-results in-store-notice"><p>{category} coming soon online. Call <a href={"tel:+91" + IN_STORE_PHONE}>{IN_STORE_PHONE}</a> to order from the store.</p>{children}</div>;
}
