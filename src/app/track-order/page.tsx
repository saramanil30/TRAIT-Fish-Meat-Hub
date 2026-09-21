import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/ui/placeholder-page";
export const metadata: Metadata = { title: "Your orders, in one place" };
export default function Page() { return <PlaceholderPage title="Your orders, in one place" description="Order tracking will be available when ordering opens. There are no live orders to track in this preview." icon="orders"/>; }
