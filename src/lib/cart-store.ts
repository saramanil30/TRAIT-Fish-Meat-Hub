"use client";

import { useSyncExternalStore } from "react";
import type { Product } from "@/types/catalog";
let products: readonly Product[] = [];
import type { CartItem, ProductSelection } from "@/types/cart";
import { cartReducer, createCartItem, restoreCart, serializeCart, type CartAction } from "@/lib/cart";

const STORAGE_KEY = "trait.preview-cart.v1";
const BUY_NOW_KEY = "trait.buy-now.v1";
const EMPTY: readonly CartItem[] = [];
let items = EMPTY;
// "Buy now" checks out a single item on its own, leaving the cart untouched.
let buyNow = EMPTY;
let hydrated = false;
const listeners = new Set<() => void>();

async function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try { const response = await fetch("/api/catalogue", {cache:"no-store"}); if (!response.ok) throw new Error("Catalogue unavailable"); products = await response.json(); items = restoreCart(window.sessionStorage.getItem(STORAGE_KEY), products); buyNow = restoreCart(window.sessionStorage.getItem(BUY_NOW_KEY), products).slice(0, 1); }
  catch { items = EMPTY; buyNow = EMPTY; } // Storage may be blocked; the in-memory cart still works.
  listeners.forEach(listener => listener());
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  hydrate();
  return () => { listeners.delete(listener); };
}
function dispatch(action: CartAction) {
  hydrate();
  items = cartReducer(items, action);
  try { window.sessionStorage.setItem(STORAGE_KEY, serializeCart(items)); }
  catch { /* Continue with an in-memory cart if tab storage is unavailable. */ }
  listeners.forEach(listener => listener());
}
function productFor(id: string) {
  const product = products.find(product => product.id === id);
  if (!product) throw new Error("This product is no longer available.");
  return product;
}
export function addCartItem(productId: string, selection: ProductSelection, id: string) {
  dispatch({ type: "add", item: createCartItem(productFor(productId), selection, id) });
}
export function updateCartItem(id: string, selection: ProductSelection) {
  hydrate();
  const item = items.find(item => item.id === id);
  if (!item) throw new Error("This item is no longer in your cart.");
  dispatch({ type: "update", item: createCartItem(productFor(item.productId), selection, id) });
}
export function setBuyNowItem(productId: string, selection: ProductSelection, id: string) {
  hydrate();
  buyNow = [createCartItem(productFor(productId), selection, id)];
  try { window.sessionStorage.setItem(BUY_NOW_KEY, serializeCart(buyNow)); }
  catch { /* Keep the in-memory item. */ }
  listeners.forEach(listener => listener());
}
export function clearBuyNow() {
  buyNow = EMPTY;
  try { window.sessionStorage.removeItem(BUY_NOW_KEY); }
  catch { /* Nothing stored. */ }
  listeners.forEach(listener => listener());
}
export function removeCartItem(id: string) { dispatch({ type: "remove", id }); }
export function clearCart() { dispatch({ type: "clear" }); }
function getSnapshot() { return items; }
function getServerSnapshot() { return EMPTY; }
export function useCart() { return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot); }
export function useBuyNow() { return useSyncExternalStore(subscribe, () => buyNow, getServerSnapshot); }

export function useCatalogue() { useCart(); return products; }