import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/ui/placeholder-page";
export const metadata: Metadata = { title: "Terms of service", description: "Terms for ordering from TRAIT Fish & Meat Hub." };
export default function Page() { return <PlaceholderPage title="Terms of service" description="Our terms, cancellation policy and refund information will be available before we begin accepting orders." icon="orders"/>; }
