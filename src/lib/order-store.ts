"use client";

import { useSyncExternalStore } from "react";
import { products } from "@/data/catalog";
import { restoreCart } from "@/lib/cart";
import { createMockOrder, EMPTY_CHECKOUT } from "@/lib/order";
import type { CartItem } from "@/types/cart";
import type { CheckoutDetails, MockOrder } from "@/types/order";

const KEY = "trait.mock-order.v1";
const initial: { ready: boolean; draft: CheckoutDetails; order: MockOrder | null } = { ready: false, draft: EMPTY_CHECKOUT, order: null };
let state = initial;
const listeners = new Set<() => void>();
function emit() { listeners.forEach(listener => listener()); }
function hydrate() {
  if (state.ready || typeof window === "undefined") return;
  let order: MockOrder | null = null;
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(KEY) ?? "null");
    if (saved?.mode === "local-preview" && /^TFM-\d{6}$/.test(saved.number) && /^[0-9a-f-]{36}$/.test(saved.trackingToken) && typeof saved.placedAt === "string" && Number.isFinite(Date.parse(saved.placedAt)) && saved.customer && Object.keys(EMPTY_CHECKOUT).every(key => typeof saved.customer[key] === "string")) {
      const items = restoreCart(JSON.stringify({ version: 1, items: saved.items }), products);
      order = createMockOrder(items, saved.customer, { number: saved.number, trackingToken: saved.trackingToken, placedAt: saved.placedAt });
    }
  } catch { /* Missing, blocked or stale session data leaves a usable empty preview. */ }
  state = { ...state, ready: true, order };
}
function subscribe(listener: () => void) { listeners.add(listener); hydrate(); emit(); return () => { listeners.delete(listener); }; }
export function useOrderState() { return useSyncExternalStore(subscribe, () => state, () => initial); }
export function saveCheckoutDraft(draft: CheckoutDetails) { hydrate(); state = { ...state, draft }; emit(); }
export function placeLocalOrder(items: readonly CartItem[], details: CheckoutDetails): MockOrder {
  hydrate();
  const order = createMockOrder(items, details, {
    number: "TFM-" + String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, "0"),
    trackingToken: crypto.randomUUID(), placedAt: new Date().toISOString(),
  });
  state = { ready: true, draft: { ...EMPTY_CHECKOUT }, order };
  try { window.sessionStorage.setItem(KEY, JSON.stringify(order)); }
  catch { /* The receipt remains available in memory until this page is refreshed. */ }
  emit();
  return order;
}
