import type { Metadata } from "next";
import { CheckoutContent } from "@/components/checkout/checkout-content";
import { storeDeliveryFee } from "@/lib/storefront-info";
import { cartOffers } from "@/lib/offers";
import { deliverySlotOptions } from "@/lib/checkout-server";
export const metadata: Metadata = { title: "Checkout", robots: { index: false } };
export default async function Page({ searchParams }: { searchParams: Promise<{ buy?: string | string[] }> }) {
  // Shown from the start; the review step replaces it with the server's quote for the customer's pincode.
  const [fee, offers, slotDays] = await Promise.all([storeDeliveryFee(), cartOffers().catch(() => []), deliverySlotOptions()]);
  return <CheckoutContent buyNow={(await searchParams).buy === "now"} deliveryFeePaise={fee.feePaise} feeVaries={fee.varies} offers={offers} slotDays={slotDays} />;
}
