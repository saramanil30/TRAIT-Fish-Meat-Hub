"use client";
import { useActionState } from "react";
import { lookupOrders, type LookupState } from "@/app/track-order/actions";
import { formatDateTimeIST, formatMoney } from "@/lib/format";

const statusText=(status:string)=>status.replaceAll("_"," ").toLowerCase().replace(/^\w/,c=>c.toUpperCase());

export function OrderLookup() {
 const [state,action,pending]=useActionState<LookupState,FormData>(lookupOrders,{});
 return <section className="order-panel order-lookup">
  <form action={action} className="order-lookup-form">
   <label htmlFor="lookup-mobile">Mobile number used for the order</label>
   <div className="order-lookup-row">
    <span className="order-lookup-prefix" aria-hidden="true">+91</span>
    <input id="lookup-mobile" name="mobile" type="tel" inputMode="numeric" autoComplete="tel-national" required pattern="[6-9][0-9]{9}" maxLength={10} placeholder="10-digit mobile number" title="Enter your 10-digit mobile number" />
    <button className="button primary" disabled={pending}>{pending?"Finding…":"Find orders"}</button>
   </div>
   <p className="field-help">Shows orders that are not yet delivered or cancelled.</p>
  </form>
  <div aria-live="polite">
   {state.message&&<p className="order-lookup-message">{state.message}</p>}
   {state.orders&&<ul className="order-lookup-list">{state.orders.map(order=><li key={order.orderNumber}><details>
    <summary><span className="order-lookup-number">{order.orderNumber}</span><span className="order-lookup-status">{statusText(order.status)}</span><time dateTime={order.placedAt}>{formatDateTimeIST(order.placedAt)}</time><strong>{formatMoney(order.totalPaise)}</strong></summary>
    <ol className="order-lookup-timeline">{(order.history??[]).map((step,i)=><li key={i}><span>{statusText(step.status)}</span><time dateTime={step.at}>{formatDateTimeIST(step.at)}</time></li>)}</ol>
   </details></li>)}</ul>}
  </div>
 </section>;
}
