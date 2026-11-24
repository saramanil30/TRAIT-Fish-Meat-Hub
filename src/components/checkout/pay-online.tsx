"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { beginOnlinePayment } from "@/app/pay/actions";

type RazorpayInstance = { open(): void; on(event: string, fn: () => void): void };
declare global { interface Window { Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance } }

let loader: Promise<void> | undefined;
function loadCheckout() {
 if (window.Razorpay) return Promise.resolve();
 return loader ??= new Promise<void>((resolve, reject) => {
  const script = document.createElement("script");
  script.src = "https://checkout.razorpay.com/v1/checkout.js";
  script.onload = () => resolve();
  script.onerror = () => { loader = undefined; reject(new Error("Could not load Razorpay Checkout.")); };
  document.head.appendChild(script);
 });
}

const STATE_TEXT: Record<string, string> = {
 PAID: "This order is already paid.",
 CANCELLED: "This order was cancelled because payment was not completed in time. Please place a new order.",
 EXPIRED: "The payment time for this order has ended. It will be cancelled shortly; please place a new order.",
 UNAVAILABLE: "Online payment is not available for this order.",
};

/** "Pay online" / "Retry payment". Opens Razorpay Checkout (UPI, cards, netbanking). A successful callback
 *  only refreshes the page: the order shows Paid once Razorpay's signed webhook has been verified. */
export function PayOnline({ source, autoStart = false, label = "Pay online", returnTo }: { source: { token: string } | { link: string }; autoStart?: boolean; label?: string; returnTo?: string }) {
 const router = useRouter();
 const [busy, setBusy] = useState(false);
 const [message, setMessage] = useState("");
 const started = useRef(false);
 async function pay() {
  if (busy) return;
  setBusy(true); setMessage("");
  try {
   const result = await beginOnlinePayment(source);
   if ("error" in result) { setMessage(result.error); return; }
   if ("state" in result) { setMessage(STATE_TEXT[result.state]); if (result.state !== "UNAVAILABLE") router.refresh(); return; }
   await loadCheckout();
   const s = result.start;
   const checkout = new window.Razorpay!({
    key: s.keyId, order_id: s.razorpayOrderId, amount: s.amountPaise, currency: s.currency,
    name: "TRAIT Fish & Meat Hub", description: "Order " + s.orderNumber, timeout: Math.max(60, s.timeoutSeconds),
    prefill: { ...(s.name ? { name: s.name } : {}), ...(s.contact ? { contact: s.contact } : {}) },
    theme: { color: "#0f5c4d" },
    // Never trusted: the browser just goes back to the order page, which shows the webhook-verified status.
    handler: () => { setMessage("Payment received by Razorpay. Confirming…"); if (returnTo) router.replace(returnTo); else router.refresh(); },
    modal: { ondismiss: () => setMessage("Payment not completed. You can retry while the order is open (30 minutes from placing it).") },
   });
   checkout.on("payment.failed", () => setMessage("The payment failed. You can try again with another method."));
   checkout.open();
  } catch { setMessage("Could not open the payment window. Check your connection and retry."); }
  finally { setBusy(false); }
 }
 useEffect(() => { if (autoStart && !started.current) { started.current = true; void pay(); } });
 return <div className="pay-online">
  <button type="button" className="button primary" onClick={pay} disabled={busy}>{busy ? "Opening payment…" : label}</button>
  {message && <p className="field-help" role="status">{message}</p>}
 </div>;
}
