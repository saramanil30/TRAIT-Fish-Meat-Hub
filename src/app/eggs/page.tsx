import type { Metadata } from "next";
import { CatalogPage } from "@/components/product/catalog-page";
export const metadata: Metadata = { title: "Eggs", description: "Farm-fresh egg trays from TRAIT Fish & Meat Hub, Hyderabad. Home delivery or store pickup." };
export default function Page() { return <CatalogPage category="eggs"/>; }
