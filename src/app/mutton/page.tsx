import type { Metadata } from "next";
import { CatalogPage } from "@/components/product/catalog-page";
export const metadata: Metadata = { title: "Mutton", description: "Fresh mutton cuts by the kg, prepared your way from TRAIT Fish & Meat Hub, Hyderabad. Home delivery or store pickup." };
export default function Page() { return <CatalogPage category="mutton"/>; }
