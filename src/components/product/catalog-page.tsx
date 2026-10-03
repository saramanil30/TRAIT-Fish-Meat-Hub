import Link from "next/link";
import { notFound } from "next/navigation";
import { liveCatalogue } from "@/lib/live-catalogue";
import { inCategory, shopCategory } from "@/lib/shop-categories";
import { ProductGrid } from "@/components/product/product-grid";
import { InStoreNotice } from "@/components/product/in-store-notice";
export async function CatalogPage({ category }: { category: string }) {
  const products = await liveCatalogue();
  const selected = shopCategory(category, products);
  // Unannounced categories with no published products have no page; chicken and mutton point to the store until published.
  if (!selected) notFound();
  if (selected.inStoreOnly) return <div className="container page-section"><Link href="/" className="back-link">← Back to home</Link><p className="eyebrow">The TRAIT collection</p><h1>{selected.name}</h1><InStoreNotice category={selected.name}><Link href="/search" className="button secondary">Shop fish, seafood &amp; eggs online</Link></InStoreNotice></div>;
  return <div className="container page-section"><Link href="/" className="back-link">← Back to home</Link><p className="eyebrow">The TRAIT collection</p><h1>{selected.name}</h1><p className="page-intro">{selected.description}.</p><ProductGrid products={products.filter(p => inCategory(p, selected))}/></div>;
}
