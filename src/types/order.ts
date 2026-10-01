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
}
export type CheckoutErrors = Partial<Record<keyof CheckoutDetails, string>>;
export interface OrderTotals {
  discountPaise?: number;
  offer?: { title: string } | null;
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
