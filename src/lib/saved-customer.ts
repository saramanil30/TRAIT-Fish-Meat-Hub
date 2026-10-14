"use client";
import { useSyncExternalStore } from "react";

/** Checkout details remembered on this device only (localStorage). Never sent anywhere or looked up by mobile. */
export const ADDRESS_LABELS = ["Home", "Office", "Other"] as const;
export type AddressLabel = (typeof ADDRESS_LABELS)[number];
export interface SavedAddress { label: AddressLabel; address: string; locality: string; landmark: string; pincode: string }
export interface SavedCustomer { name: string; mobile: string; addresses: SavedAddress[]; last?: AddressLabel }

const KEY = "trait.saved-customer";
const text = (value: unknown, max: number) => typeof value === "string" ? value.slice(0, max) : "";
const isLabel = (value: unknown): value is AddressLabel => ADDRESS_LABELS.includes(value as AddressLabel);

/** Whatever is stored is untrusted: keep only known fields, as strings, within the checkout limits. */
function parse(raw: string | null): SavedCustomer | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const addresses = (Array.isArray(value.addresses) ? value.addresses : []).filter((a): a is Record<string, unknown> => !!a && typeof a === "object" && isLabel((a as Record<string, unknown>).label))
      .map(a => ({ label: a.label as AddressLabel, address: text(a.address, 240), locality: text(a.locality, 100), landmark: text(a.landmark, 150), pincode: text(a.pincode, 6) }))
      .filter((a, i, all) => a.address && all.findIndex(b => b.label === a.label) === i);
    const saved: SavedCustomer = { name: text(value.name, 80), mobile: text(value.mobile, 20), addresses, last: isLabel(value.last) ? value.last : undefined };
    return saved.name || saved.mobile || addresses.length ? saved : null;
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

/** After an order: keep the name and mobile, and the delivery address under its label (replacing that label's old one). */
export function rememberCustomer(customer: { name: string; mobile: string }, address?: SavedAddress) {
  load();
  const previous = snapshot;
  const addresses = previous?.addresses.filter(a => a.label !== address?.label) ?? [];
  if (address) addresses.push({ ...address, address: address.address.trim(), locality: address.locality.trim(), landmark: address.landmark.trim(), pincode: address.pincode.trim() });
  addresses.sort((a, b) => ADDRESS_LABELS.indexOf(a.label) - ADDRESS_LABELS.indexOf(b.label));
  write({ name: customer.name.trim() || previous?.name || "", mobile: customer.mobile.trim(), addresses, last: address?.label ?? previous?.last });
}
export function forgetCustomer() { load(); write(null); }

export const sameAddress = (a: Pick<SavedAddress, "address" | "locality" | "landmark" | "pincode">, b: { address?: string; locality?: string; landmark?: string; pincode?: string }) =>
  a.address.trim() === (b.address ?? "").trim() && a.locality.trim() === (b.locality ?? "").trim() && a.landmark.trim() === (b.landmark ?? "").trim() && a.pincode.trim() === (b.pincode ?? "").trim();
