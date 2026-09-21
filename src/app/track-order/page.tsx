import type { Metadata } from "next";
import { OrderTracking } from "@/components/checkout/order-tracking";
export const metadata: Metadata = { title: "Track your order" };
export default function Page() { return <OrderTracking />; }
