"use server";
import { rateLimit, logCheckoutFailure } from "@/lib/checkout-server";
import { publicRpc } from "@/lib/supabase";
import { startOnlinePayment, verifyPayLink, type PaymentStart } from "@/lib/razorpay";

/** Starts or retries Razorpay Checkout from a tracking token or a signed WhatsApp pay link.
 *  The amount and Razorpay order come from the server; nothing the browser sends sets them. */
export async function beginOnlinePayment(source: { token: string } | { link: string }): Promise<PaymentStart | { error: string }> {
 try {
  await rateLimit("pay", 20);
  let paymentId: string | null = null;
  if ("token" in source) {
   if (typeof source.token !== "string" || !/^[a-f0-9]{64}$/.test(source.token)) return { state: "UNAVAILABLE" };
   const order = await publicRpc<{ onlinePaymentId?: string | null; paymentStatus?: string } | null>("track_order", { tracking_token: source.token });
   if (order?.paymentStatus === "PAID") return { state: "PAID" };
   paymentId = order?.onlinePaymentId ?? null;
  } else paymentId = typeof source.link === "string" ? verifyPayLink(source.link) : null;
  if (!paymentId) return { state: "UNAVAILABLE" };
  return await startOnlinePayment(paymentId);
 } catch (cause) {
  logCheckoutFailure("pay", cause);
  return { error: cause instanceof Error && cause.message.startsWith("Too many") ? cause.message : "Online payment is temporarily unavailable. Please try again, or contact the store." };
 }
}
