"use client";
import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { useCart } from "@/lib/cart-store";
export function CartLink() {
  const items = useCart();
  const label = items.length + " " + (items.length === 1 ? "item" : "items");
  return <Link href="/cart" aria-label={"Cart, " + label} className="cart-link"><span className="cart-icon"><Icon name="cart" /><span className="count" aria-live="polite" aria-atomic="true">{items.length}</span></span><span className="cart-label">{label}</span></Link>;
}
