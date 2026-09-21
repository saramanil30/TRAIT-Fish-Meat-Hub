import Image from "next/image";
import type { Product } from "@/types/catalog";
import { formatPrice } from "@/lib/format";
export function ProductCard({ product }: {
    product: Product;
}) { return <article className="product-card"><div className="product-image"><Image src={product.image} alt={product.imageAlt} width={480} height={360}/><span className={product.available ? "availability" : "availability unavailable"}>{product.available ? "Available" : "Sold out"}</span></div><div className="product-body"><p className="product-cut">{product.cut}</p><h3>{product.name}</h3><p className="local-name">{product.localName || "Selected for your kitchen"}</p><div className="product-bottom"><p><strong>{formatPrice(product.pricePerKg)}</strong><span> /kg</span></p><button className="add-button" type="button" disabled aria-label={"Add " + product.name + " - ordering coming soon"}>+ Add</button></div></div></article>; }
