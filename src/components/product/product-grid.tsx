import type { Product } from "@/types/catalog";
import { ProductCard } from "@/components/product/product-card";
export function ProductGrid({ products }: {
    products: readonly Product[];
}) { return <div className="product-grid">{products.map(product => <ProductCard key={product.id} product={product}/>)}</div>; }
