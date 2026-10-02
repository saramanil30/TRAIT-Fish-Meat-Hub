"use client";
import { useState } from "react";
import type { Product } from "@/types/catalog";
import { ProductGrid } from "./product-grid";
import { inCategory, shopCategories } from "@/lib/shop-categories";
export function CatalogBrowser({ products, title = "Popular fresh cuts", eyebrow = "The TRAIT collection", titleId = "fresh-title" }: { products: readonly Product[]; title?: string; eyebrow?: string; titleId?: string }) {
  // Same names and membership as the category cards; empty categories get no chip.
  const categories = shopCategories(products);
  const filters = ["All", ...categories.map(c => c.name)];
  const [filter, setFilter] = useState("All");
  const selected = categories.find(c => c.name === filter);
  const filtered = products.filter(product => !selected || inCategory(product, selected));
  return <section className="catalog-browser" aria-labelledby={titleId}><div className="section-heading catalog-heading"><div><p className="eyebrow">{eyebrow}</p><h2 id={titleId}>{title}</h2></div><div className="catalog-filters" role="group" aria-label="Filter products">{filters.map(value => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{value}</button>)}</div></div><p className="sr-only" role="status">{filtered.length} products shown for {filter}</p>{filtered.length ? <ProductGrid products={filtered} /> : <div className="empty-results"><h3>No matching products in {filter}</h3><p>Try another category or search term.</p><button type="button" className="button secondary" onClick={() => setFilter("All")}>Show all results</button></div>}</section>;
}
