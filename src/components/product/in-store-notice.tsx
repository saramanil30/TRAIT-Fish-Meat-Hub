import { IN_STORE_PHONE } from "@/lib/shop-categories";
/** Shown for an announced category (chicken, mutton) until its products are published online. */
export function InStoreNotice({ category, children }: { category: string; children?: React.ReactNode }) {
  return <div className="empty-results in-store-notice"><p>Fresh {category.toLowerCase()} is available in store — call <a href={"tel:+91" + IN_STORE_PHONE}>{IN_STORE_PHONE}</a> to order.</p>{children}</div>;
}
