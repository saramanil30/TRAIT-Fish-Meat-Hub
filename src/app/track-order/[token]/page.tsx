import type { Metadata } from "next";
import { OrderTracking } from "@/components/checkout/order-tracking";
export const metadata: Metadata = { title: "Track your order preview", robots: { index: false, follow: false } };
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <OrderTracking token={token} />;
}
