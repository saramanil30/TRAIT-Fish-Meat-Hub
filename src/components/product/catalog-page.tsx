import Link from "next/link";
import { notFound } from "next/navigation";
import { liveCatalogue } from "@/lib/live-catalogue";
import { inCategory, shopCategory } from "@/lib/shop-categories";
import { ProductGrid } from "@/components/product/product-grid";
export async function CatalogPage({ category }: { category: string }) {
  const products = await liveCatalogue();
  const selected = shopCategory(category, products);
  // Unannounced categories with no published products have no page; announced ones show "Coming soon".
  if (!selected) notFound();
  if (selected.comingSoon) return <div className="container page-section"><Link href="/" className="back-link">← Back to home</Link><p className="eyebrow">The TRAIT collection</p><h1>{selected.name}</h1><div className="empty-results coming-soon"><h2>Coming soon</h2><p>We are getting our {selected.name.toLowerCase()} range ready. Explore fish, seafood and eggs in the meantime.</p><Link href="/search" className="button primary">Shop the collection</Link></div></div>;
  return <div className="container page-section"><Link href="/" className="back-link">← Back to home</Link><p className="eyebrow">The TRAIT collection</p><h1>{selected.name}</h1><p className="page-intro">{selected.description}.</p><ProductGrid products={products.filter(p => inCategory(p, selected))}/></div>;
}
