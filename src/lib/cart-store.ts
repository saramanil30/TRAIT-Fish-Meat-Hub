"use client";

import { useSyncExternalStore } from "react";
import { products } from "@/data/catalog";
import type { CartItem, ProductSelection } from "@/types/cart";
import { cartReducer, createCartItem, restoreCart, serializeCart, type CartAction } from "@/lib/cart";

const STORAGE_KEY = "trait.preview-cart.v1";
const EMPTY: readonly CartItem[] = [];
let items = EMPTY;
let hydrated = false;
const listeners = new Set<() => void>();

function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try { items = restoreCart(window.sessionStorage.getItem(STORAGE_KEY), products); }
  catch { items = EMPTY; } // Storage may be blocked; the in-memory cart still works.
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
export function removeCartItem(id: string) { dispatch({ type: "remove", id }); }
export function clearCart() { dispatch({ type: "clear" }); }
function getSnapshot() { return items; }
function getServerSnapshot() { return EMPTY; }
export function useCart() { return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot); }
