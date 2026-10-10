import Link from "next/link";
import { notFound } from "next/navigation";
import { liveShop } from "@/lib/live-catalogue";
import { inCategory, shopCategory } from "@/lib/shop-categories";
import { ProductGrid } from "@/components/product/product-grid";
import { InStoreNotice } from "@/components/product/in-store-notice";
export async function CatalogPage({ category }: { category: string }) {
  const { products, categories } = await liveShop();
  const selected = shopCategory(category, products, categories);
  // Every top-level category has a page; one with no products online yet shows the call-us notice.
  if (!selected) notFound();
  if (selected.inStoreOnly) return <div className="container page-section"><Link href="/" className="back-link">← Back to home</Link><p className="eyebrow">The TRAIT collection</p><h1>{selected.name}</h1><InStoreNotice category={selected.name}><Link href="/search" className="button secondary">See everything online</Link></InStoreNotice></div>;
  return <div className="container page-section"><Link href="/" className="back-link">← Back to home</Link><p className="eyebrow">The TRAIT collection</p><h1>{selected.name}</h1><p className="page-intro">{selected.description}.</p><ProductGrid products={products.filter(p => inCategory(p, selected))}/></div>;
}
