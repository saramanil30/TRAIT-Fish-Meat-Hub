import type { Metadata } from "next";
import Link from "next/link";
import { products } from "@/data/catalog";
import { ProductGrid } from "@/components/product/product-grid";
import { SearchForm } from "@/components/ui/search-form";
export const metadata: Metadata = { title: "Search the collection" };
export default async function SearchPage({ searchParams }: {
    searchParams: Promise<{
        q?: string | string[];
    }>;
}) { const params = await searchParams; const query = (typeof params.q === "string" ? params.q : "").slice(0, 100).trim(); const words = query.toLocaleLowerCase("en-IN").split(/\s+/).filter(Boolean); const results = products.filter(p => words.every(word => [p.name, p.localName ?? "", p.category, p.cut].join(" ").toLocaleLowerCase("en-IN").includes(word))); return <div className="container page-section"><p className="eyebrow">Find your next favourite</p><h1>Explore the collection</h1><div className="page-search"><SearchForm id="catalog-search" defaultValue={query}/></div><p className="preview-note">Sample catalogue · Illustrative images, prices and availability. Preview cart available. Checkout coming later.</p><h2 className="results-heading">{query ? results.length + " results for “" + query + "”" : "All products"}</h2>{results.length ? <ProductGrid products={results}/> : <div className="empty-results"><h3>No matching products</h3><p>Try fish, prawns or a local name like Vanjaram.</p><Link href="/search" className="text-link">Clear search</Link></div>}</div>; }
