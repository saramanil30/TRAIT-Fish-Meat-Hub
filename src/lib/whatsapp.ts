import { formatMoney } from "./format";

/** WhatsApp click-to-send (wa.me): links and every message template. Free; nothing is sent until the person taps Send. */
export const SHOP_WHATSAPP = "+918686146562";
/** Desktop browsers reuse one WhatsApp Web tab with this name instead of opening a new tab each time. */
export const WHATSAPP_WINDOW = "trait-wa";

/** wa.me link for an E.164 number (e.g. "+919876543210"), with an optional pre-filled message. */
export function whatsappLink(e164: string, text?: string): string {
  return "https://wa.me/" + e164.replace(/\D/g, "") + (text ? "?text=" + encodeURIComponent(text) : "");
}

type StatusOrder = { name?: string; number: string; totalPaise: number; status: string; pickup: boolean; site: string };
/** Staff → customer: a message for the order's current status. */
export function customerStatusMessage(o: StatusOrder): string {
  const hi = "Hi" + (o.name ? " " + o.name : "") + ", your TRAIT order " + o.number + " (" + formatMoney(o.totalPaise) + ")";
  const track = " Track with your mobile: " + o.site + "/track-order";
  switch (o.status) {
    case "CONFIRMED": return hi + " is confirmed. We are preparing it fresh for you." + track;
    case "OUT_FOR_DELIVERY": return hi + " is out for delivery. Please keep your phone handy." + track;
    case "READY": return o.pickup ? hi + " is ready for pickup. Please bring your order number to the store." + track : hi + " is packed and will be out for delivery soon." + track;
    case "DELIVERED": return hi + (o.pickup ? " has been picked up." : " has been delivered.") + " Thank you for shopping with TRAIT!";
    case "CANCELLED": return hi + " has been cancelled. Reply here if you have any questions.";
    case "PREPARING": return hi + " is being cleaned and cut your way." + track;
    default: return hi + " has been received. We will confirm it shortly." + track;
  }
}

/** What the confirmation page knows only in the ordering browser: the items and the delivery address. */
export type ShopOrderDetails = { items: string[]; address?: string };
/** sessionStorage key: checkout saves the details here just before opening the confirmation page. */
export const shopOrderKey = (trackingToken: string) => "trait-wa-order:" + trackingToken;
type ShopOrder = ShopOrderDetails & { number: string; totalPaise?: number; pickup: boolean };
/** Customer → shop: the placed order, so the shop has it in WhatsApp. */
export function orderToShopMessage(o: ShopOrder): string {
  return ["Hi TRAIT, I just placed order " + o.number + ".",
    ...(o.items.length ? ["", "Items:", ...o.items.map(i => "• " + i)] : []),
    "",
    ...(o.totalPaise !== undefined ? ["Total: " + formatMoney(o.totalPaise)] : []),
    o.pickup ? "Store pickup" : "Home delivery" + (o.address ? " to: " + o.address : ""),
  ].join("\n");
}
