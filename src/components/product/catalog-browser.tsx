import type { Product } from "@/types/catalog";
import { ProductGrid } from "./product-grid";
// Category filtering lives in the header category row; this section lists the products it is given.
export function CatalogBrowser({ products, title = "Popular fresh cuts", eyebrow = "The TRAIT collection", titleId = "fresh-title" }: { products: readonly Product[]; title?: string; eyebrow?: string; titleId?: string }) {
  return <section className="catalog-browser" aria-labelledby={titleId}><div className="section-heading catalog-heading"><div><p className="eyebrow">{eyebrow}</p><h2 id={titleId}>{title}</h2></div></div>{products.length ? <ProductGrid products={products} /> : <div className="empty-results"><h3>No matching products</h3><p>Try another category or search term.</p></div>}</section>;
}
