import type { Metadata } from "next";
import { OrderReceipt } from "@/components/checkout/order-receipt";
export const metadata: Metadata = { title: "Order preview received", robots: { index: false, follow: false } };
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <OrderReceipt token={token} />;
}
