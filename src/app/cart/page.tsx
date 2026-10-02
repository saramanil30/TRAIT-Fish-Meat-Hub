import type { Metadata } from "next";
import { CartContent } from "@/components/cart/cart-content";
import { storeDeliveryFee } from "@/lib/storefront-info";
export const metadata: Metadata = { title: "Your cart" };
export default async function Page() {
  // Fee shown in the cart comes from the store's delivery settings; checkout still quotes the exact charge server-side.
  const fee = await storeDeliveryFee();
  return <CartContent deliveryFeePaise={fee.feePaise} feeVaries={fee.varies} />;
}
