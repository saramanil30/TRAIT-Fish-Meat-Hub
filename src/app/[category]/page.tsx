import type { Metadata } from "next";
import { CatalogPage } from "@/components/product/catalog-page";
/** One page per top-level catalogue category, at /{slug} (e.g. /river-fish, /crabs-lobsters). Unknown slugs 404. */
export async function generateMetadata({ params }: { params: Promise<{ category: string }> }): Promise<Metadata> {
  const name = (await params).category.split("-").filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(" ");
  return { title: name, description: "Fresh " + name.toLowerCase() + ", cleaned and cut your way from TRAIT Fish & Meat Hub, Hyderabad. Home delivery or store pickup." };
}
export default async function Page({ params }: { params: Promise<{ category: string }> }) {
  return <CatalogPage category={(await params).category} />;
}
