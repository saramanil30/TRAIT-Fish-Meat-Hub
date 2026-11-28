/** Per-pincode delivery mode: the shop's own fixed fee, or "Via Rapido" (₹0 in our total; the customer pays Rapido separately). */
export type DeliveryMode = "SHOP" | "RAPIDO";
/** A delivery area as published by api.storefront_info. Older rows without `mode` are shop deliveries. */
export type DeliveryArea = { pincode: string; name: string; feePaise: number; minimumPaise: number; mode?: DeliveryMode; rapidoEstimate?: string | null; advanceRequired?: boolean };
/** The Rapido part of a delivery rule, from an area, a quote or a placed order. */
export type RapidoDelivery = { estimate?: string | null; advanceRequired?: boolean };

export const isRapido = (area?: { mode?: string | null } | null) => area?.mode === "RAPIDO";
export function rapidoOf(area?: { mode?: string | null; rapidoEstimate?: string | null; advanceRequired?: boolean } | null): RapidoDelivery | undefined {
  return isRapido(area) ? { estimate: area?.rapidoEstimate ?? null, advanceRequired: !!area?.advanceRequired } : undefined;
}
export function areaForPincode(areas: readonly DeliveryArea[], pincode?: string | null): DeliveryArea | undefined {
  const pin = pincode?.trim();
  return pin && /^[1-9]\d{5}$/.test(pin) ? areas.find(a => a.pincode === pin) : undefined;
}
/** Saved addresses arrive masked, ending in the pincode: "Flat 4**, ***** Road, Kokapet 500075". */
export const pincodeOfMasked = (masked: string) => /([1-9]\d{5})\s*$/.exec(masked)?.[1];
/** "Via Rapido: approx ₹60–150, paid separately. Not included in our total. Advance payment required (no cash on delivery)." */
export function rapidoNote(r: RapidoDelivery): string {
  return "Via Rapido: " + (r.estimate ? r.estimate.replace(/[.\s]+$/, "") : "the Rapido charge is paid separately") + ". Not included in our total." + (r.advanceRequired ? " Advance payment required (no cash on delivery)." : "");
}
