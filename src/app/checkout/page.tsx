import type { Metadata } from "next";
import { CheckoutContent } from "@/components/checkout/checkout-content";
import { storeDeliveryFee } from "@/lib/storefront-info";
export const metadata: Metadata = { title: "Checkout" };
export default async function Page({ searchParams }: { searchParams: Promise<{ buy?: string | string[] }> }) {
  // Shown from the start; the review step replaces it with the server's quote for the customer's pincode.
  const fee = await storeDeliveryFee();
  return <CheckoutContent buyNow={(await searchParams).buy === "now"} deliveryFeePaise={fee.feePaise} feeVaries={fee.varies} />;
}
