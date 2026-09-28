import { Hero } from "@/components/home/hero";
import { CategorySection } from "@/components/home/category-section";
import { TrustSection } from "@/components/home/trust-section";
import { CatalogBrowser } from "@/components/product/catalog-browser";
import { liveCatalogue } from "@/lib/live-catalogue";
export default async function Home() {
  const products = await liveCatalogue();
  return <><Hero /><CategorySection /><div className="container section fresh-section"><CatalogBrowser products={products} /></div><TrustSection /></>;
}
