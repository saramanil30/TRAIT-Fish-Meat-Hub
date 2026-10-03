import type { CartItem } from "@/types/cart";

/** An active offer with the product ids it covers ("ALL" for store-wide), resolved server-side. */
export type CartOffer = { id: string; title: string; kind: "PERCENT" | "FIXED"; value: number; productIds: readonly string[] | "ALL" };
export type AppliedOffer = { offer: CartOffer; discountPaise: number; itemIds: readonly string[] };

/** Mirrors app.offer_discount: single best offer on merchandise, PERCENT in basis points, capped at the eligible subtotal. Checkout's quote stays authoritative. */
export function bestCartOffer(offers: readonly CartOffer[], items: readonly CartItem[]): AppliedOffer | null {
  let best: AppliedOffer | null = null;
  for (const offer of offers) {
    const eligible = items.filter(item => offer.productIds === "ALL" || offer.productIds.includes(item.productId));
    const eligiblePaise = eligible.reduce((sum, item) => sum + item.lineTotalPaise, 0);
    const discountPaise = Math.min(eligiblePaise, offer.kind === "PERCENT" ? Math.floor(eligiblePaise * offer.value / 10000) : offer.value);
    if (discountPaise <= 0) continue;
    if (!best || discountPaise > best.discountPaise || (discountPaise === best.discountPaise && offer.id < best.offer.id)) best = { offer, discountPaise, itemIds: eligible.map(item => item.id) };
  }
  return best;
}

export function offerTag(offer: CartOffer) {
  return offer.kind === "PERCENT" ? offer.value / 100 + "% off" : "Offer";
}
