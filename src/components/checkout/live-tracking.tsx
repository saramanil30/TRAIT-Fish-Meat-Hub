import { formatDateTimeIST, formatMoney } from "@/lib/format";
import Link from "next/link";
import { publicRpc } from "@/lib/supabase";
import { rateLimit } from "@/lib/checkout-server";
import { storefrontInfo, phoneDigits } from "@/lib/storefront-info";
import { IN_STORE_PHONE } from "@/lib/shop-categories";
import { SendOrderWhatsApp } from "./send-order-whatsapp";
import { slotLabel, type OrderSlot } from "@/lib/delivery-slots";
type Tracking={subtotalPaise?:number;discountPaise?:number;deliveryFeePaise?:number;totalPaise?:number;offerTitle?:string;slot?:OrderSlot|null;orderNumber:string;status:string;method:string;paymentStatus:string;history:{status:string;at:string}[]};
const statusText=(status:string)=>status.replaceAll("_"," ").toLowerCase().replace(/^\w/,c=>c.toUpperCase());
/** Order status for the confirmation page (`confirmation`) and the private tracking link. */
export async function LiveTracking({token,confirmation=false}:{token:string;confirmation?:boolean}) {
 let order:Tracking|null=null;
 try {if(/^[a-f0-9]{64}$/.test(token)){await rateLimit("tracking",60);order=await publicRpc<Tracking|null>("track_order",{tracking_token:token});}} catch {}
 const store=await storefrontInfo();
 const phone=store?.phone?phoneDigits(store.phone):"91"+IN_STORE_PHONE;
 const whatsapp=store?.whatsapp?phoneDigits(store.whatsapp):phone;
 const pickup=order?.method==="STORE_PICKUP";
 const slot=order?.slot?slotLabel(order.slot):undefined;
 const help=<div className="order-help"><h2>Need help with this order?</h2><div className="order-help-actions"><a className="button secondary" href={"tel:+"+phone}>Call the store</a><a className="button secondary" href={"https://wa.me/"+whatsapp} target="_blank" rel="noopener noreferrer">WhatsApp us</a></div></div>;
 if(!order) return <div className="container page-section order-status-page"><h1>Order unavailable</h1><section className="order-panel"><p>This tracking link is invalid, expired, or temporarily unavailable. You can look up open orders with the mobile number you used.</p><div className="order-help-actions"><Link className="button primary" href="/track-order">Find my order</Link><Link className="button secondary" href="/">Continue shopping</Link></div>{help}</section></div>;
 return <div className="container page-section order-status-page">
  {confirmation ? <div className="order-confirmed"><span className="order-confirmed-check" aria-hidden="true">✓</span><div><p className="eyebrow">Order placed</p><h1>Thank you! Your order is in.</h1><p>Order number <strong>{order.orderNumber}</strong>{order.totalPaise!==undefined&&<> · Total <strong>{formatMoney(order.totalPaise)}</strong></>}</p>{slot&&<p className="order-slot">{pickup?"Pickup":"Delivery"}: {slot}</p>}<SendOrderWhatsApp token={token} number={order.orderNumber} totalPaise={order.totalPaise} pickup={pickup} slot={slot}/></div></div>
   : <><p className="eyebrow">Track your order</p><h1>{order.orderNumber}</h1></>}
  <div className="order-status-layout">
   <section className="order-panel tracking-panel" aria-labelledby="order-status-title">
    <p className="order-status-label">Current status</p><h2 id="order-status-title">{statusText(order.status)}</h2>
    {slot&&<p className="order-slot">{pickup?"Pickup slot":"Delivery slot"}: {slot}</p>}
    <p>{pickup?"Store pickup":"Home delivery"} · Payment: {order.paymentStatus==="PENDING"?"cash or UPI at "+(pickup?"pickup":"delivery"):statusText(order.paymentStatus)}</p>
    {order.totalPaise!==undefined&&<dl className="order-totals"><div><dt>Subtotal</dt><dd>{formatMoney(order.subtotalPaise??0)}</dd></div>{!!order.discountPaise&&<div><dt>Coupon discount{order.offerTitle?" — "+order.offerTitle:""}</dt><dd className="order-discount">−{formatMoney(order.discountPaise)}</dd></div>}<div><dt>Delivery</dt><dd>{pickup?"Free (store pickup)":formatMoney(order.deliveryFeePaise??0)}</dd></div><div className="order-grand-total"><dt>Total to pay</dt><dd>{formatMoney(order.totalPaise)}</dd></div></dl>}
    <h3>Order updates</h3><ol className="order-lookup-timeline">{order.history.map((h,i)=><li key={i}><span>{statusText(h.status)}</span><time dateTime={h.at}>{formatDateTimeIST(h.at)}</time></li>)}</ol>
    <Link className="button secondary" href={"/track-order/"+token}>Refresh status</Link>
   </section>
   <aside className="order-panel order-next">
    <h2>What happens next</h2>
    <ol className="order-next-steps"><li><strong>The store confirms your order</strong><span>We check your selection and call you if anything needs a change.</span></li><li><strong>Cleaned and cut your way</strong><span>Your fish or meat is prepared fresh to your choices.</span></li><li><strong>{pickup?"Collect from the store":"Delivered to your door"}</strong><span>{pickup?"Bring your order number":"Keep your phone handy"}; pay by cash or UPI.</span></li></ol>
    {confirmation&&<p className="field-help">Bookmark this page to track your order, or use Track Order with your mobile number.</p>}
    {help}
    <Link className="text-link" href="/">Continue shopping</Link>
   </aside>
  </div>
 </div>;
}
