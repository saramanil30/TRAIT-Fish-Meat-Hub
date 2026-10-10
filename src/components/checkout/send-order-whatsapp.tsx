"use client";
import { useSyncExternalStore } from "react";
import { SHOP_WHATSAPP, WHATSAPP_WINDOW, orderToShopMessage, shopOrderKey, whatsappLink, type ShopOrderDetails } from "@/lib/whatsapp";

const noSubscribe = () => () => {};
/** "Send order to shop on WhatsApp" on the confirmation page. Items and address come from the ordering browser's
 *  session (saved at checkout); on any other device the message still has the order number, total and method. */
export function SendOrderWhatsApp({ token, number, totalPaise, pickup, slot }: { token: string; number: string; totalPaise?: number; pickup: boolean; slot?: string }) {
  const saved = useSyncExternalStore(noSubscribe, () => { try { return sessionStorage.getItem(shopOrderKey(token)); } catch { return null; } }, () => null);
  let details: ShopOrderDetails = { items: [] };
  try { if (saved) details = JSON.parse(saved); } catch { /* Send without items. */ }
  return <a className="button primary whatsapp-send" href={whatsappLink(SHOP_WHATSAPP, orderToShopMessage({ ...details, number, totalPaise, pickup, slot }))} target={WHATSAPP_WINDOW}>Send order to shop on WhatsApp</a>;
}
