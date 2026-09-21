import type { Metadata } from "next";
import { CatalogPage } from "@/components/product/catalog-page";
export const metadata: Metadata = { title: "Chicken" };
export default function Page() { return <CatalogPage category="chicken"/>; }
