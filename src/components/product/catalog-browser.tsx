"use client";
import { useState } from "react";
import type { Product } from "@/types/catalog";
import { ProductGrid } from "./product-grid";
const primaryFilters = ["All", "Fish", "Chicken", "Mutton"];
export function CatalogBrowser({ products, title = "Popular fresh cuts", eyebrow = "The TRAIT collection", titleId = "fresh-title" }: { products: readonly Product[]; title?: string; eyebrow?: string; titleId?: string }) {
  const filters=[...primaryFilters,...new Set(products.map(p=>p.category).filter(c=>!["fish","seafood","chicken","mutton"].includes(c)).map(c=>c.charAt(0).toUpperCase()+c.slice(1)))];
  const [filter, setFilter] = useState("All");
  const filtered = products.filter(product => filter === "All" || product.category === filter.toLowerCase() || (filter === "Fish" && product.category === "seafood"));
  return <section className="catalog-browser" aria-labelledby={titleId}><div className="section-heading catalog-heading"><div><p className="eyebrow">{eyebrow}</p><h2 id={titleId}>{title}</h2></div><div className="catalog-filters" role="group" aria-label="Filter products">{filters.map(value => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{value}</button>)}</div></div><p className="sr-only" role="status">{filtered.length} products shown for {filter}</p>{filtered.length ? <ProductGrid products={filtered} /> : <div className="empty-results"><h3>No matching products in {filter}</h3><p>Try another category or search term.</p><button type="button" className="button secondary" onClick={() => setFilter("All")}>Show all results</button></div>}</section>;
}
