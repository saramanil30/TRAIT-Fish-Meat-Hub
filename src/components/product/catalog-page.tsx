import Link from "next/link";
import { categories } from "@/data/catalog";
import { liveCatalogue } from "@/lib/live-catalogue";
import type { CategorySlug } from "@/types/catalog";
import { ProductGrid } from "@/components/product/product-grid";
export async function CatalogPage({ category }: {
    category: CategorySlug;
}) { const products = await liveCatalogue(); const selected = categories.find(c => c.slug === category)!; return <div className="container page-section"><Link href="/" className="back-link">← Back to home</Link><p className="eyebrow">The TRAIT collection</p><h1>{selected.name}</h1><p className="page-intro">{selected.description}.</p><ProductGrid products={products.filter(p => p.category === category || (category === "fish" && p.category === "seafood"))}/></div>; }
