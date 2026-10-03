import type { Metadata } from "next";
import { CartContent } from "@/components/cart/cart-content";
import { storeDeliveryFee } from "@/lib/storefront-info";
import { cartOffers } from "@/lib/offers";
export const metadata: Metadata = { title: "Your cart" };
export default async function Page() {
  // Fee shown in the cart comes from the store's delivery settings; checkout still quotes the exact charge server-side.
  const [fee, offers] = await Promise.all([storeDeliveryFee(), cartOffers().catch(() => [])]);
  return <CartContent deliveryFeePaise={fee.feePaise} feeVaries={fee.varies} offers={offers} />;
}
