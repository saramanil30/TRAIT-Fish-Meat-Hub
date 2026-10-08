import type { CartItem } from "@/types/cart";
import { formatMoney } from "./format";

/** An active offer with its coupon code and the product ids it covers ("ALL" for store-wide), resolved server-side.
 *  minOrderPaise is the eligible subtotal the coupon needs (0 = none); maxDiscountPaise caps a percent discount. */
export type CartOffer = { id: string; title: string; code: string; condition: string; kind: "PERCENT" | "FIXED"; value: number; minOrderPaise: number; maxDiscountPaise: number | null; productIds: readonly string[] | "ALL" };
export type AppliedCoupon = { offer: CartOffer; discountPaise: number; itemIds: readonly string[] };

export const COUPON_PATTERN = /^[A-Z0-9]{3,20}$/;
const rupees = (paise: number) => Math.floor(paise / 100) * 100;

function eligibleLines(offer: CartOffer, items: readonly CartItem[]) {
  const eligible = items.filter(item => offer.productIds === "ALL" || offer.productIds.includes(item.productId));
  return { eligible, eligiblePaise: eligible.reduce((sum, item) => sum + item.lineTotalPaise, 0) };
}

/** Mirrors app.offer_discount: only the offer's eligible lines, once they reach the minimum; rounded to the nearest whole
 *  rupee, capped at the percent maximum, never above the eligible amount and always leaving merchandise payable.
 *  Checkout's quote stays authoritative. */
export function couponDiscount(offer: CartOffer, items: readonly CartItem[]): AppliedCoupon | null {
  const { eligible, eligiblePaise } = eligibleLines(offer, items);
  if (eligiblePaise < offer.minOrderPaise) return null;
  const subtotalPaise = items.reduce((sum, item) => sum + item.lineTotalPaise, 0);
  const raw = offer.kind === "PERCENT" ? Math.floor(eligiblePaise * offer.value / 10000) : offer.value;
  const cap = offer.kind === "PERCENT" && offer.maxDiscountPaise !== null ? offer.maxDiscountPaise : Infinity;
  const discountPaise = Math.min(Math.round(raw / 100) * 100, cap, rupees(eligiblePaise), rupees(Math.max(subtotalPaise - 1, 0)));
  return discountPaise > 0 ? { offer, discountPaise, itemIds: eligible.map(item => item.id) } : null;
}

/** How much more (whole rupees, in paise) of the offer's eligible items the cart needs to reach its minimum; 0 when met.
 *  Null when the cart has none of a scoped offer's items, since "add more" would not help. */
export function couponShortfall(offer: CartOffer, items: readonly CartItem[]): number | null {
  const { eligiblePaise } = eligibleLines(offer, items);
  if (offer.productIds !== "ALL" && eligiblePaise === 0) return null;
  return Math.max(Math.ceil((offer.minOrderPaise - eligiblePaise) / 100) * 100, 0);
}

/** "Add ₹120 more to use SAVE10", or null when the minimum is met or does not apply. */
export function shortfallMessage(offer: CartOffer, items: readonly CartItem[]): string | null {
  const short = couponShortfall(offer, items);
  return short ? "Add " + formatMoney(short) + " more" + (offer.productIds === "ALL" ? "" : " of eligible items") + " to use " + offer.code : null;
}

export function appliedCoupon(offers: readonly CartOffer[], code: string | null, items: readonly CartItem[]): AppliedCoupon | null {
  const offer = code ? offers.find(o => o.code === code) : undefined;
  return offer ? couponDiscount(offer, items) : null;
}

export function offerTag(offer: CartOffer) {
  return offer.kind === "PERCENT" ? offer.value / 100 + "% off" : "Offer";
}
