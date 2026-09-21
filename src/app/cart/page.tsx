import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/ui/placeholder-page";
export const metadata: Metadata = { title: "Your cart is waiting" };
export default function Page() { return <PlaceholderPage title="Your cart is waiting" description="Your cart has 0 items. Adding products and placing orders will be available in a future release. For now, explore the sample collection." icon="bag"/>; }
