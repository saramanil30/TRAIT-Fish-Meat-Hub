import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/ui/placeholder-page";
export const metadata: Metadata = { title: "Privacy information" };
export default function Page() { return <PlaceholderPage title="Privacy information" description="Our privacy policy will be published before customer accounts, order details or other personal information are collected." icon="orders"/>; }
