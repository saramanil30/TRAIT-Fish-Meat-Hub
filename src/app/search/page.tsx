import type { Metadata } from "next";
import { liveCatalogue } from "@/lib/live-catalogue";
import { CatalogBrowser } from "@/components/product/catalog-browser";
import { SearchForm } from "@/components/ui/search-form";
export const metadata: Metadata = { title: "Search the collection", description: "Search fresh fish, seafood, chicken, mutton and eggs at TRAIT Fish & Meat Hub." };
export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const products = await liveCatalogue();
  const params = await searchParams;
  const query = (typeof params.q === "string" ? params.q : "").slice(0, 100).trim();
  const words = query.toLocaleLowerCase("en-IN").split(/\s+/).filter(Boolean);
  const results = products.filter(p => words.every(word => [p.name, p.localName ?? "", p.category, p.cut].join(" ").toLocaleLowerCase("en-IN").includes(word)));
  return <div className="container page-section"><p className="eyebrow">Find your next favourite</p><h1>Explore the collection</h1><div className="page-search"><SearchForm id="catalog-search" defaultValue={query} /></div><CatalogBrowser key={query} products={results} title={query ? results.length + " results for “" + query + "”" : "All products"} eyebrow="Choose your category" titleId="search-results-title" /></div>;
}
