"use client";
import { useSyncExternalStore } from "react";
import { COUPON_PATTERN } from "./cart-offer";

// The customer's applied code, kept for this browser tab so it carries from cart to checkout.
const COUPON_KEY = "trait.coupon.v1";
const listeners = new Set<() => void>();
let coupon: string | null | undefined;
function read() {
  if (coupon === undefined) {
    try { const stored = window.sessionStorage.getItem(COUPON_KEY); coupon = stored && COUPON_PATTERN.test(stored) ? stored : null; }
    catch { coupon = null; }
  }
  return coupon;
}
export function setCoupon(code: string | null) {
  coupon = code;
  try { if (code) window.sessionStorage.setItem(COUPON_KEY, code); else window.sessionStorage.removeItem(COUPON_KEY); } catch { /* In-memory coupon still works. */ }
  listeners.forEach(listener => listener());
}
export function useCoupon() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, read, () => null);
}
