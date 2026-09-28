"use client";
import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { formatMoney } from "@/lib/format";
import { cartSubtotalPaise } from "@/lib/cart";
import { useCart } from "@/lib/cart-store";
export function CartLink() {
  const items = useCart();
  return <Link href="/cart" aria-label={`Cart, ${items.length} ${items.length === 1 ? "item" : "items"}`} className="cart-link"><Icon name="bag" /><span>{formatMoney(cartSubtotalPaise(items))}</span><span className="count" aria-live="polite" aria-atomic="true">{items.length}</span></Link>;
}
