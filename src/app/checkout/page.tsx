import type { Metadata } from "next";
import { CheckoutContent } from "@/components/checkout/checkout-content";
export const metadata: Metadata = { title: "Checkout" };
export default async function Page({ searchParams }: { searchParams: Promise<{ buy?: string | string[] }> }) {
  return <CheckoutContent buyNow={(await searchParams).buy === "now"} />;
}
