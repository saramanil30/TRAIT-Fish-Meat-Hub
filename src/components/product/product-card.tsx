import { AddProductButton } from "@/components/product/add-product-button";
import Image from "next/image";
import type { Product } from "@/types/catalog";
import { formatPrice, formatWeight } from "@/lib/format";
export function ProductCard({ product }: { product: Product }) {
  return <article className="product-card"><div className="product-image"><Image src={product.image} alt={product.imageAlt} width={480} height={360} sizes="(max-width: 767px) 46vw, (max-width: 1199px) 44vw, 23vw" /><span className={product.available ? "availability" : "availability unavailable"}>{product.available ? "Available" : "Sold out"}</span></div><div className="product-body"><p className="product-cut">{product.cut}</p><h3>{product.name}</h3><p className="local-name">{product.localName || "Selected for your kitchen"}</p><p className="card-weight-note">Raw weights: {product.selectableWeightsGrams.map(formatWeight).join(" · ")}</p><div className="product-bottom"><p><strong>{formatPrice(product.pricePerKg)}</strong><span> /kg</span></p><AddProductButton product={product} /></div></div></article>;
}
