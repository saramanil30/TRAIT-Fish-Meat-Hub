import type { Metadata } from "next";
import { CatalogPage } from "@/components/product/catalog-page";
export const metadata: Metadata = { title: "Seafood & Prawns", description: "Fresh prawns and seafood by the kg, cleaned your way from TRAIT Fish & Meat Hub, Hyderabad. Home delivery or store pickup." };
export default function Page() { return <CatalogPage category="seafood"/>; }
