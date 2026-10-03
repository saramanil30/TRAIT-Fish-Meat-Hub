import type { Metadata } from "next";
import { CatalogPage } from "@/components/product/catalog-page";
export const metadata: Metadata = { title: "Chicken", description: "Fresh chicken cuts by the kg, cleaned and cut your way from TRAIT Fish & Meat Hub, Hyderabad. Home delivery or store pickup." };
export default function Page() { return <CatalogPage category="chicken"/>; }
