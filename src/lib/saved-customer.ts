"use client";
import { useSyncExternalStore } from "react";

/** Name and mobile remembered on this device (localStorage) to prefill checkout. Saved addresses live on the server. */
export interface SavedCustomer { name: string; mobile: string }

const KEY = "trait.saved-customer";
const text = (value: unknown, max: number) => typeof value === "string" ? value.slice(0, max) : "";

/** Whatever is stored is untrusted: keep only known fields, as strings, within the checkout limits. */
function parse(raw: string | null): SavedCustomer | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const saved: SavedCustomer = { name: text(value.name, 80), mobile: text(value.mobile, 20) };
    return saved.name || saved.mobile ? saved : null;
  } catch { return null; }
}

let snapshot: SavedCustomer | null = null;
let loaded = false;
const listeners = new Set<() => void>();
function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try { snapshot = parse(localStorage.getItem(KEY)); } catch { snapshot = null; }
}
function write(next: SavedCustomer | null) {
  snapshot = next;
  // Older versions also stored full addresses here; rewriting drops them.
  try { if (next) localStorage.setItem(KEY, JSON.stringify(next)); else localStorage.removeItem(KEY); } catch { /* Private mode or blocked storage: remembered for this page only. */ }
  listeners.forEach(fn => fn());
}
function onStorage(event: StorageEvent) { if (event.key === KEY || event.key === null) { loaded = false; load(); listeners.forEach(fn => fn()); } }
function subscribe(fn: () => void) {
  load();
  if (!listeners.size) window.addEventListener("storage", onStorage);
  listeners.add(fn);
  return () => { listeners.delete(fn); if (!listeners.size) window.removeEventListener("storage", onStorage); };
}

export function useSavedCustomer() { return useSyncExternalStore(subscribe, () => { load(); return snapshot; }, () => null); }

/** After an order: keep the name and mobile for next time. */
export function rememberCustomer(customer: { name: string; mobile: string }) {
  load();
  write({ name: customer.name.trim() || snapshot?.name || "", mobile: customer.mobile.trim() });
}
