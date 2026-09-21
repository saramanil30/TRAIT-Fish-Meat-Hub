import Link from "next/link";
import { categories, products } from "@/data/catalog";
import type { CategorySlug } from "@/types/catalog";
import { ProductGrid } from "@/components/product/product-grid";
export function CatalogPage({ category }: {
    category: CategorySlug;
}) { const selected = categories.find(c => c.slug === category)!; return <div className="container page-section"><Link href="/" className="back-link">← Back to home</Link><p className="eyebrow">The TRAIT collection</p><h1>{selected.name}</h1><p className="page-intro">{selected.description}.</p><nav className="filter-links" aria-label="Product categories">{categories.map(c => <Link key={c.slug} href={"/" + c.slug} aria-current={category === c.slug ? "page" : undefined}>{c.name}</Link>)}</nav><p className="preview-note">Sample catalogue · Illustrative images, prices and availability. Ordering coming soon.</p><ProductGrid products={products.filter(p => p.category === category)}/></div>; }
