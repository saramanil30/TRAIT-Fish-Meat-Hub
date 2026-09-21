import type { Metadata } from "next";
import { CartContent } from "@/components/cart/cart-content";
export const metadata: Metadata = { title: "Your cart" };
export default function Page() { return <CartContent />; }
