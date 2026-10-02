import type { Metadata } from "next";
import { CartContent } from "@/components/cart/cart-content";
import { storefrontInfo } from "@/lib/storefront-info";
export const metadata: Metadata = { title: "Your cart" };
export default async function Page() {
  // Fee shown in the cart comes from the store's delivery settings; checkout still quotes the exact charge server-side.
  const info = await storefrontInfo();
  const fees = info?.delivery ? (info.areas ?? []).map(a => Number(a.feePaise)).filter(Number.isFinite) : [];
  return <CartContent deliveryFeePaise={fees.length ? Math.min(...fees) : null} feeVaries={new Set(fees).size > 1} />;
}
