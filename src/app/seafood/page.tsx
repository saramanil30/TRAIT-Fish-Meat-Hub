import type { Metadata } from "next";
import { CatalogPage } from "@/components/product/catalog-page";
export const metadata: Metadata = { title: "Seafood & Prawns" };
export default function Page() { return <CatalogPage category="seafood"/>; }
