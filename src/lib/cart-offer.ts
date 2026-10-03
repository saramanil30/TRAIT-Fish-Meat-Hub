import type { CartItem } from "@/types/cart";

/** An active offer with its coupon code and the product ids it covers ("ALL" for store-wide), resolved server-side. */
export type CartOffer = { id: string; title: string; code: string; condition: string; kind: "PERCENT" | "FIXED"; value: number; productIds: readonly string[] | "ALL" };
export type AppliedCoupon = { offer: CartOffer; discountPaise: number; itemIds: readonly string[] };

export const COUPON_PATTERN = /^[A-Z0-9]{3,20}$/;
const rupees = (paise: number) => Math.floor(paise / 100) * 100;

/** Mirrors app.offer_discount: only the offer's eligible lines, rounded to the nearest whole rupee, never above the eligible amount and always leaving merchandise payable. Checkout's quote stays authoritative. */
export function couponDiscount(offer: CartOffer, items: readonly CartItem[]): AppliedCoupon | null {
  const eligible = items.filter(item => offer.productIds === "ALL" || offer.productIds.includes(item.productId));
  const eligiblePaise = eligible.reduce((sum, item) => sum + item.lineTotalPaise, 0);
  const subtotalPaise = items.reduce((sum, item) => sum + item.lineTotalPaise, 0);
  const raw = offer.kind === "PERCENT" ? Math.floor(eligiblePaise * offer.value / 10000) : offer.value;
  const discountPaise = Math.min(Math.round(raw / 100) * 100, rupees(eligiblePaise), rupees(Math.max(subtotalPaise - 1, 0)));
  return discountPaise > 0 ? { offer, discountPaise, itemIds: eligible.map(item => item.id) } : null;
}

export function appliedCoupon(offers: readonly CartOffer[], code: string | null, items: readonly CartItem[]): AppliedCoupon | null {
  const offer = code ? offers.find(o => o.code === code) : undefined;
  return offer ? couponDiscount(offer, items) : null;
}

export function offerTag(offer: CartOffer) {
  return offer.kind === "PERCENT" ? offer.value / 100 + "% off" : "Offer";
}
