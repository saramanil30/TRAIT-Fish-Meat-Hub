import Link from "next/link";
import { notFound } from "next/navigation";
import { liveCatalogue } from "@/lib/live-catalogue";
import { inCategory, shopCategory } from "@/lib/shop-categories";
import { ProductGrid } from "@/components/product/product-grid";
export async function CatalogPage({ category }: { category: string }) {
  const products = await liveCatalogue();
  const selected = shopCategory(category, products);
  // Categories with no published products are hidden everywhere, including their own page.
  if (!selected) notFound();
  return <div className="container page-section"><Link href="/" className="back-link">← Back to home</Link><p className="eyebrow">The TRAIT collection</p><h1>{selected.name}</h1><p className="page-intro">{selected.description}.</p><ProductGrid products={products.filter(p => inCategory(p, selected))}/></div>;
}
