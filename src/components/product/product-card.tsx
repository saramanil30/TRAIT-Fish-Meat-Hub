import { AddProductButton } from "@/components/product/add-product-button";
import Image from "next/image";
import type { Product } from "@/types/catalog";
import {cardQuantityLine, priceLabel} from "@/lib/pricing";
export function ProductCard({ product }: { product: Product }) {
  return <article className="product-card"><div className="product-image"><Image src={product.image} alt={product.imageAlt} width={480} height={360} sizes="(max-width: 767px) 46vw, (max-width: 1199px) 44vw, 23vw" /><span className={product.available ? "availability" : "availability unavailable"}>{product.orderable===false ? "Catalogue" : product.available ? "Available" : "Sold out"}</span></div><div className="product-body">{product.cut && <p className="product-cut">{product.cut}</p>}<h3>{product.name}</h3>{product.localName && <p className="local-name">{product.localName}</p>}<p className="card-weight-note">{cardQuantityLine(product)}</p><p className="card-price"><strong>{priceLabel(product)}</strong></p><div className="product-bottom"><AddProductButton product={product} /></div></div></article>;
}
