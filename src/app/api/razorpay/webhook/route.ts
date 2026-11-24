import { createHash } from "node:crypto";
import { applyWebhookEvent, verifyWebhookSignature } from "@/lib/razorpay";
import { logCheckoutFailure } from "@/lib/checkout-server";

/** Razorpay webhook (payment.captured, payment.failed, refund.processed, refund.failed).
 *  Signature-checked on the raw body; idempotent on Razorpay's event id; writes only through the verifier login. */
export async function POST(request: Request) {
 const raw = await request.text();
 if (raw.length > 1_000_000 || !verifyWebhookSignature(raw, request.headers.get("x-razorpay-signature"))) return new Response("Invalid signature", { status: 401 });
 let event;
 try { event = JSON.parse(raw); } catch { return new Response("Invalid body", { status: 400 }); }
 if (typeof event?.event !== "string" || typeof event?.payload !== "object") return new Response("Invalid event", { status: 400 });
 const header = request.headers.get("x-razorpay-event-id");
 const eventId = header && /^[A-Za-z0-9_-]{1,200}$/.test(header) ? header : "sha256:" + createHash("sha256").update(raw).digest("hex");
 try {
  const result = await applyWebhookEvent(event, eventId);
  return Response.json({ result });
 } catch (cause) {
  // Temporary failure: a 5xx makes Razorpay retry the same event, which is safe to replay.
  logCheckoutFailure("razorpay-webhook", cause);
  return new Response("Temporarily unavailable", { status: 503 });
 }
}
