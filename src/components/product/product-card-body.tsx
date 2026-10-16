"use client";
import { useRef, type ReactNode } from "react";
import type { Product } from "@/types/catalog";
import { AddProductButton, type AddProductHandle } from "@/components/product/add-product-button";

/** Card name, price and buttons. When the product can be ordered, the name is a button stretched over the whole card
 *  (photo, name, price) that opens the same options popup as "Add to cart"; the action buttons sit above it, so they never double-trigger. */
export function ProductCardBody({ product, children }: { product: Product; children: ReactNode }) {
  const add = useRef<AddProductHandle>(null);
  const clickable = product.available && product.orderable !== false;
  return <div className="item-card-body">
    <h3>{clickable ? <button type="button" className="item-card-open" onClick={() => add.current?.choose()} aria-label={"View options for " + product.name}>{product.name}</button> : product.name}</h3>
    {children}<AddProductButton ref={add} product={product} />
  </div>;
}
