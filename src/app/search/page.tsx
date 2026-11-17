import type { Metadata } from "next";
import Link from "next/link";
import { liveShop } from "@/lib/live-catalogue";
import { searchProducts } from "@/lib/search";
import { shopCategories } from "@/lib/shop-categories";
import { SHOP_WHATSAPP, WHATSAPP_WINDOW, whatsappLink } from "@/lib/whatsapp";
import { CatalogBrowser } from "@/components/product/catalog-browser";
import { WhatsAppGlyph } from "@/components/layout/whatsapp-button";
import { SearchForm } from "@/components/ui/search-form";
export const metadata: Metadata = { title: "Search the collection", description: "Search fresh fish, seafood, chicken, mutton and eggs at TRAIT Fish & Meat Hub." };

/** Search results use the standard product card. Only the live catalogue is searched (what the storefront shows). */
export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const { products, categories } = await liveShop();
  const params = await searchParams;
  const query = (typeof params.q === "string" ? params.q : "").slice(0, 100).trim();
  const results = query ? searchProducts(products, query) : products;
  const title = query ? results.length + (results.length === 1 ? " result" : " results") + " for “" + query + "”" : "All products";
  const empty = query && !results.length
    ? <div className="empty-results search-empty"><h3>We couldn’t find “{query}”</h3>
        <p>Check the spelling, try a local name (like Vanjaram or Chanduva) or browse a category:</p>
        <ul className="search-empty-links">{shopCategories(products, categories).filter(c => !c.inStoreOnly).map(c => <li key={c.slug}><Link href={"/" + c.slug}>{c.name}</Link></li>)}<li><Link href="/search">All products</Link></li></ul>
        <p>Looking for something we haven’t listed? Ask us — we often have it in the shop.</p>
        <a className="button primary search-empty-whatsapp" href={whatsappLink(SHOP_WHATSAPP, "Hi TRAIT, do you have " + query + "?")} target={WHATSAPP_WINDOW}><WhatsAppGlyph />Ask on WhatsApp</a>
      </div>
    : undefined;
  return <div className="container page-section"><p className="eyebrow">Find your next favourite</p><h1>Explore the collection</h1><div className="page-search"><SearchForm id="catalog-search" defaultValue={query} /></div><CatalogBrowser key={query} products={results} title={title} eyebrow="Choose your category" titleId="search-results-title" empty={empty} /></div>;
}
