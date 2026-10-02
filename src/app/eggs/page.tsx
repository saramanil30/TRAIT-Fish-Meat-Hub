import type { Metadata } from "next";
import { CatalogPage } from "@/components/product/catalog-page";
export const metadata: Metadata = { title: "Eggs" };
export default function Page() { return <CatalogPage category="eggs"/>; }
