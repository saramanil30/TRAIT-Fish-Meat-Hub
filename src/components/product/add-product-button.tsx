"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Product } from "@/types/catalog";
import { isRaw, quantityOptions } from "@/lib/pricing";
import { setBuyNowItem } from "@/lib/cart-store";
import { BUY_NOW_CHECKOUT, needsOptions, ProductSelection } from "@/components/product/product-selection";
export function AddProductButton({ product }: { product: Product }) {
  const [open, setOpen] = useState(false);
  const [added, setAdded] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  const disabled = !product.available || product.orderable === false;
  function choose() { setAdded(false); setError(""); setOpen(true); }
  function buyNow() {
    if (needsOptions(product)) return choose();
    try {
      const amount = quantityOptions(product)[0];
      setBuyNowItem(product.id, { preparationId: product.preparationOptions[0].id, ...(isRaw(product) ? { rawWeightGrams: amount } : { quantity: amount }), specialInstructions: "" }, crypto.randomUUID());
      router.push(BUY_NOW_CHECKOUT);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not start checkout. Please try again."); }
  }
  return <div className="product-add"><div className="product-actions"><button className="add-button" type="button" disabled={disabled} onClick={choose} aria-label={product.available ? "Choose " + product.name : product.name + " is sold out"}>{product.orderable===false?"Ordering unavailable":"Add to cart"}</button>
    {product.orderable !== false && <button className="add-button buy-now-button" type="button" disabled={disabled} onClick={buyNow} aria-label={"Buy " + product.name + " now"}>Buy now</button>}</div>
    {added && <span className="added-feedback" role="status">Added. <Link href="/cart">View cart</Link></span>}
    {error && <span className="cart-error" role="alert">{error}</span>}
    {open && <ProductSelection product={product} onClose={() => setOpen(false)} onSaved={() => setAdded(true)} />}
  </div>;
}
