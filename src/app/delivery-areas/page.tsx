import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/ui/placeholder-page";
export const metadata: Metadata = { title: "Freshness, closer to home" };
export default function Page() { return <PlaceholderPage title="Freshness, closer to home" description="Delivery locations and service hours are being finalised. Confirmed delivery areas will be listed here before launch." icon="truck"/>; }
