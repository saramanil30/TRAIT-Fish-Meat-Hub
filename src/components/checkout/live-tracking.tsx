import { formatMoney } from "@/lib/format";
import Link from "next/link";
import { publicRpc } from "@/lib/supabase";
import { rateLimit } from "@/lib/checkout-server";
type Tracking={subtotalPaise?:number;discountPaise?:number;deliveryFeePaise?:number;totalPaise?:number;offerTitle?:string;orderNumber:string;status:string;method:string;paymentStatus:string;history:{status:string;at:string}[]};
export async function LiveTracking({token}:{token:string}) {
 let order:Tracking|null=null;
 try {if(/^[a-f0-9]{64}$/.test(token)){await rateLimit("tracking",60);order=await publicRpc<Tracking|null>("track_order",{tracking_token:token});}} catch {}
 return <div className="container page-section"><p className="eyebrow">TRAIT orders</p><h1>{order?order.orderNumber:"Order unavailable"}</h1>{order?<section className="order-panel tracking-panel"><h2>{order.status.replaceAll("_"," ")}</h2><p>{order.method==="STORE_PICKUP"?"Store Pickup":"Home Delivery"}</p><p>Payment: {order.paymentStatus}</p>{order.totalPaise!==undefined&&<dl className="order-totals"><div><dt>Subtotal</dt><dd>{formatMoney(order.subtotalPaise??0)}</dd></div>{!!order.discountPaise&&<div><dt>Offer discount — {order.offerTitle}</dt><dd>−{formatMoney(order.discountPaise)}</dd></div>}<div><dt>Delivery charge</dt><dd>{formatMoney(order.deliveryFeePaise??0)}</dd></div><div className="order-grand-total"><dt>Final payable</dt><dd>{formatMoney(order.totalPaise)}</dd></div></dl>}<ol>{order.history.map((h,i)=><li key={i}>{h.status.replaceAll("_"," ")} · <time dateTime={h.at}>{new Date(h.at).toLocaleString("en-IN",{timeZone:"Asia/Kolkata"})}</time></li>)}</ol><Link className="button secondary" href={"/track-order/"+token}>Refresh status</Link></section>:<p>This tracking link is invalid, expired, or temporarily unavailable.</p>}<Link href="/">Continue shopping</Link></div>;
}
