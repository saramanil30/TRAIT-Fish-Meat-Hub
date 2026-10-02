import { cartSubtotalPaise } from "./cart";
import type { CartItem } from "../types/cart";
import type { CheckoutDetails, CheckoutErrors, DeliveryMethod, MockOrder, OrderStatus, OrderTotals } from "../types/order";

// Preview configuration only. A future server must calculate its own delivery fee,
// prices and cleaning estimates from validated catalogue choices, never these totals.
export const MOCK_DELIVERY_CHARGE_PAISE = 4000;
export const EMPTY_CHECKOUT: CheckoutDetails = {
  deliveryMethod: "delivery", paymentMethod: "cash", name: "", mobile: "",
  address: "", locality: "", landmark: "", pincode: "",
};
export function normalizeMobile(value: string): string {
  const compact = value.replace(/[\s()-]/g, "");
  return compact.replace(/^(?:\+91|91)(?=[6-9]\d{9}$)/, "");
}
/** Delivery is Hyderabad-only; city and state are fixed, and the server sets them itself. */
export const SERVICE_CITY = "Hyderabad";
export const SERVICE_STATE = "Telangana";
export function validateCheckout(details: CheckoutDetails): CheckoutErrors {
  const errors: CheckoutErrors = {};
  if (!["delivery", "pickup"].includes(details.deliveryMethod)) errors.deliveryMethod = "Choose a delivery method.";
  if (!["cash", "upi"].includes(details.paymentMethod)) errors.paymentMethod = "Choose a payment method.";
  if ((details.deliveryMethod === "delivery" || details.name.trim()) && (details.name.trim().length < 2 || details.name.trim().length > 80)) errors.name = "Enter your name (2-80 characters).";
  if (!/^[6-9]\d{9}$/.test(normalizeMobile(details.mobile))) errors.mobile = "Enter a valid 10-digit Indian mobile number, optionally with +91.";
  if (details.deliveryMethod === "delivery") {
    if (details.address.trim().length < 5 || details.address.trim().length > 300) errors.address = "Enter your delivery address (5-300 characters).";
    if (details.locality.trim().length < 2 || details.locality.trim().length > 100) errors.locality = "Enter your area / locality (2-100 characters).";
    if (details.landmark.trim().length > 150) errors.landmark = "Keep the landmark within 150 characters.";
    if (!/^[1-9]\d{5}$/.test(details.pincode.trim())) errors.pincode = "Enter a valid 6-digit Indian pincode.";
  }
  return errors;
}
export function orderTotals(items: readonly CartItem[], method: DeliveryMethod, deliveryFee = MOCK_DELIVERY_CHARGE_PAISE): OrderTotals {
  if (!Number.isSafeInteger(deliveryFee) || deliveryFee < 0) throw new Error("Invalid delivery charge.");
  const subtotalPaise = cartSubtotalPaise(items);
  const deliveryChargePaise = method === "delivery" && items.length > 0 ? deliveryFee : 0;
  const grandTotalPaise = subtotalPaise + deliveryChargePaise;
  if (!Number.isSafeInteger(grandTotalPaise) || grandTotalPaise < 0) throw new Error("Invalid order total.");
  return { subtotalPaise, deliveryChargePaise, grandTotalPaise };
}
// This is the local placement boundary. Phase 5 must send choices and customer
// details to a secure server, which independently validates/reprices them and
// returns an order receipt. Do not send browser totals as authoritative prices.
export function createMockOrder(items: readonly CartItem[], details: CheckoutDetails, identity: { number: string; trackingToken: string; placedAt: string }): MockOrder {
  if (!items.length) throw new Error("Your cart is empty. Add a selection before checkout.");
  if (Object.keys(validateCheckout(details)).length) throw new Error("Please check your checkout details.");
  const customer = { ...details, name: details.name.trim(), mobile: normalizeMobile(details.mobile), address: details.address.trim(), locality: details.locality.trim(), landmark: details.landmark.trim(), pincode: details.pincode.trim() };
  if (customer.deliveryMethod === "pickup") Object.assign(customer, { address: "", locality: "", landmark: "", pincode: "" });
  return { mode: "local-preview", ...identity, status: "PLACED", customer, items: items.map(item => ({ ...item, preparation: { ...item.preparation } })), totals: orderTotals(items, details.deliveryMethod) };
}
export function trackingSteps(method: DeliveryMethod): OrderStatus[] {
  return method === "pickup" ? ["PLACED", "CONFIRMED", "PREPARING", "READY", "DELIVERED"] : ["PLACED", "CONFIRMED", "PREPARING", "READY", "OUT_FOR_DELIVERY", "DELIVERED"];
}
export function statusLabel(status: OrderStatus, method: DeliveryMethod): string {
  if (status === "DELIVERED" && method === "pickup") return "Collected";
  if (status === "READY" && method === "pickup") return "Ready for pickup";
  return { PLACED: "Order received", CONFIRMED: "Confirmed", PREPARING: "Preparing your selection", READY: "Ready", OUT_FOR_DELIVERY: "Out for delivery", DELIVERED: "Delivered", CANCELLED: "Cancelled" }[status];
}
