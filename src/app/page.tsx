import { Hero } from "@/components/home/hero";
import { TrustSection } from "@/components/home/trust-section";
import { CatalogBrowser } from "@/components/product/catalog-browser";
import { liveCatalogue } from "@/lib/live-catalogue";
export default async function Home() {
  const products = await liveCatalogue();
  return <><Hero /><div className="fresh-band"><div className="container section fresh-section"><CatalogBrowser products={products} /></div></div><TrustSection /></>;
}
