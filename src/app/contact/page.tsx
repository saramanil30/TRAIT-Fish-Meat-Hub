import type { Metadata } from "next";
import { PlaceholderPage } from "@/components/ui/placeholder-page";
export const metadata: Metadata = { title: "Let’s stay in touch" };
export default function Page() { return <PlaceholderPage title="Let’s stay in touch" description="Our contact details and customer support hours will be published before ordering opens." icon="orders"/>; }
