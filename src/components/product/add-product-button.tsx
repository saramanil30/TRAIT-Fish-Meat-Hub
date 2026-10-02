"use client";
import Link from "next/link";
import { useState } from "react";
import type { Product } from "@/types/catalog";
import { ProductSelection } from "@/components/product/product-selection";
export function AddProductButton({ product }: { product: Product }) {
  const [open, setOpen] = useState(false);
  const [added, setAdded] = useState(false);
  return <div className="product-add"><button className="add-button" type="button" disabled={!product.available || product.orderable===false} onClick={() => { setAdded(false); setOpen(true); }} aria-label={product.available ? "Choose " + product.name : product.name + " is sold out"}>{product.orderable===false?"Ordering unavailable":"Add to cart"}</button>
    {added && <span className="added-feedback" role="status">Added. <Link href="/cart">View cart</Link></span>}
    {open && <ProductSelection product={product} onClose={() => setOpen(false)} onSaved={() => setAdded(true)} />}
  </div>;
}
