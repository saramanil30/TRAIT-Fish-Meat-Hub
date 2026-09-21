import type { Metadata } from "next";
import { CheckoutContent } from "@/components/checkout/checkout-content";
export const metadata: Metadata = { title: "Checkout" };
export default function Page() { return <CheckoutContent />; }
