"use server";
import { logCheckoutFailure, rateLimit, requestRestockAlert } from "@/lib/checkout-server";
import { normalizeMobile } from "@/lib/order";
import { pushTarget } from "@/lib/web-push";

export type RestockState = { ok?: boolean; available?: boolean; message?: string };
/** One answer whether or not this number already asked, so a request never reveals another shopper's. */
export async function notifyWhenAvailable(_state: RestockState, form: FormData): Promise<RestockState> {
 try {
  const product = String(form.get("product") ?? "");
  const digits = normalizeMobile(String(form.get("mobile") ?? "").slice(0, 20));
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(product)) return { message: "Could not save your request. Please reload and try again." };
  if (!/^[6-9]\d{9}$/.test(digits)) return { message: "Enter a valid 10-digit Indian mobile number." };
  const pushJson = String(form.get("push") ?? "");
  const push = pushJson ? pushTarget(pushJson) : null;
  await rateLimit("restock-ip", 6);
  const mobile = "+91" + digits;
  await rateLimit("restock-number", 4, mobile);
  const status = await requestRestockAlert(product, mobile, push);
  if (status === "AVAILABLE") return { available: true, message: "Good news: this is back in stock. Reload the page to order." };
  return { ok: true, message: push ? "Done! We'll alert this browser and may WhatsApp you when it's back (within 7 days)." : "Done! We'll WhatsApp you when it's back (within 7 days)." };
 } catch (cause) {
  logCheckoutFailure("restock request", cause);
  return { message: cause instanceof Error && /Too many requests/.test(cause.message) ? "Too many requests. Please wait a minute." : "Could not save your request right now. Please try again later." };
 }
}
