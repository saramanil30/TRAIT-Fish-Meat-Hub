import type { CartItem } from "./cart";

export type DeliveryMethod = "delivery" | "pickup";
export type PaymentMethod = "cash" | "upi";
export type OrderStatus = "PLACED" | "CONFIRMED" | "PREPARING" | "READY" | "OUT_FOR_DELIVERY" | "DELIVERED" | "CANCELLED";
export interface CheckoutDetails {
  deliveryMethod: DeliveryMethod;
  paymentMethod: PaymentMethod;
  name: string;
  mobile: string;
  address: string;
  locality: string;
  landmark: string;
  pincode: string;
  city?: string;
  state?: string;
  /** Chosen delivery/pickup slot and its India date; absent when the store has no slots. */
  slotId?: string;
  slotDate?: string;
  /** Delivery to a saved address of this mobile (its id only); the server resolves the full address. */
  savedAddressId?: string;
  /** Label a new delivery address is saved under with the order. */
  addressLabel?: AddressLabel;
}
export const ADDRESS_LABELS = ["Home", "Office", "Other"] as const;
export type AddressLabel = (typeof ADDRESS_LABELS)[number];
/** A saved address as checkout sees it: masked, e.g. "Flat 4**, ***** Road, Kokapet 500075". */
export interface SavedAddressOption { id: string; label: string; masked: string }
export type CheckoutErrors = Partial<Record<keyof CheckoutDetails, string>>;
export interface OrderTotals {
  discountPaise?: number;
  offer?: { title: string; code?: string } | null;
  subtotalPaise: number;
  deliveryChargePaise: number;
  grandTotalPaise: number;
}
export interface MockOrder {
  mode: "local-preview";
  number: string;
  trackingToken: string;
  placedAt: string;
  status: OrderStatus;
  customer: CheckoutDetails;
  items: readonly CartItem[];
  totals: OrderTotals;
}
