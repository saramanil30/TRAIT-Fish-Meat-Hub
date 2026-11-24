import Link from "next/link";
import type { ReactNode } from "react";
import { storefrontInfo, storeAddress } from "@/lib/storefront-info";

/** Shared layout for the policy pages (Privacy, Terms, Refund & Cancellation), with the store's live contact details. */
export async function PolicyPage({ eyebrow, title, updated, children }: { eyebrow: string; title: string; updated: string; children: ReactNode }) {
 const store = await storefrontInfo();
 return <section className="container page-section info-page policy-page"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="field-help">Last updated {updated}</p>
  <div className="order-panel policy-body">{children}
   <h2>Contact us</h2><p>{store ? <>{store.name}, {storeAddress(store.address)}.{store.phone && <> Phone {store.phone}.</>}</> : "TRAIT Fish & Meat Hub, Kokapet, Hyderabad, Telangana."} See <Link className="text-link" href="/contact">Contact us</Link> for hours, phone and WhatsApp.</p>
  </div></section>;
}
