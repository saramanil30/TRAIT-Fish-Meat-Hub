"use client";
import Link from "next/link";
import { useState } from "react";
import { useOrderState } from "@/lib/order-store";
import { statusLabel, trackingSteps } from "@/lib/order";
import type { DeliveryMethod, OrderStatus } from "@/types/order";

export function OrderTracking({ token }: { token?: string }) {
  const { ready, order } = useOrderState();
  const [previewStatus, setPreviewStatus] = useState<OrderStatus | "">("");
  const [demoMethod, setDemoMethod] = useState<DeliveryMethod>("delivery");
  const matching = order && (!token || order.trackingToken === token) ? order : null;
  const method = matching?.customer.deliveryMethod ?? demoMethod;
  const steps = trackingSteps(method);
  const status = previewStatus || matching?.status || "PLACED";
  if (!ready) return <div className="container page-section"><p role="status">Loading tracking preview...</p></div>;
  if (token && !matching) return <div className="container page-section"><h1>Tracking preview unavailable</h1><p>This link does not match the latest mock order in this browser tab. Local previews cannot be looked up on another device.</p><Link href="/track-order" className="button secondary">Explore sample tracking</Link></div>;
  return <div className="container page-section tracking-page"><p className="eyebrow">From our counter to your table</p><h1>Track your order</h1><p className="order-preview-note">Mock tracking only. No live updates, delivery promises, or real order processing. Preview controls below do not change an order.</p><div className="order-panel"><p className="receipt-number">{matching?.number ?? "TFM-000125"} <span>&middot; {matching ? "Local mock order" : "Sample order"}</span></p><p>{method === "delivery" ? "Home Delivery" : "Store Pickup"}</p><div className="tracking-current" role="status" aria-live="polite"><span>{previewStatus || !matching ? "Sample status" : "Current mock status"}</span><h2>{statusLabel(status, method)}</h2><p>{status === "CANCELLED" ? "This sample order is cancelled. No further preparation or delivery is shown." : status === "DELIVERED" ? (method === "pickup" ? "Sample complete: collected from the store." : "Sample complete: delivered to the customer.") : "In live ordering, this status would update after confirmation from the store. No action is required for this preview."}</p></div>
      {status !== "CANCELLED" && <ol className="tracking-timeline" aria-label="Order progress">{steps.map((step, index) => <li key={step} aria-current={status === step ? "step" : undefined} className={index < steps.indexOf(status) ? "completed" : ""}><span className="tracking-dot" aria-hidden="true">{index + 1}</span><div><strong>{statusLabel(step, method)}</strong><small>{index < steps.indexOf(status) ? "Completed (sample)" : status === step ? "Current step" : "Upcoming"}</small></div></li>)}</ol>}
      <div className="tracking-demo"><h3>Explore the status preview</h3>{!matching && <><label htmlFor="demo-method">Sample delivery method</label><select id="demo-method" value={demoMethod} onChange={event => { setDemoMethod(event.target.value as DeliveryMethod); setPreviewStatus(""); }}><option value="delivery">Home Delivery</option><option value="pickup">Store Pickup</option></select></>}<label htmlFor="demo-status">Sample status</label><select id="demo-status" value={previewStatus} onChange={event => setPreviewStatus(event.target.value as OrderStatus | "")}><option value="">{matching ? "Actual local status (Order received)" : "Choose a sample status"}</option>{[...steps, "CANCELLED" as const].map(step => <option key={step} value={step}>{statusLabel(step, method)}</option>)}</select></div>
      <div className="order-actions">{matching && <Link className="button secondary" href={"/order-confirmation/" + matching.trackingToken}>View order summary</Link>}<Link className="text-link" href="/search">Continue shopping</Link></div>
    </div></div>;
}
