import { IN_STORE_PHONE } from "@/lib/shop-categories";
/** Shown for chicken and mutton until their products are published online. */
export function InStoreNotice({ children }: { children?: React.ReactNode }) {
  return <div className="empty-results in-store-notice"><p>Fresh chicken &amp; mutton available in store — call <a href={"tel:+91" + IN_STORE_PHONE}>{IN_STORE_PHONE}</a> to order.</p>{children}</div>;
}
