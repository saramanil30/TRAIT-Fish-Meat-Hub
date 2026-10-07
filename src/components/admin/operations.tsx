import Link from "next/link";
import { randomUUID } from "node:crypto";
import { staffRpc,type StaffContext } from "@/lib/admin/server";
import { OperationalForm } from "./operational-form";
import { formatMoney, formatWeight } from "@/lib/format";
import { ActionDialog } from "./action-dialog";
import { deliveryAddress } from "@/lib/address";
import { headers } from "next/headers";
import { whatsappLink, customerStatusMessage, WHATSAPP_WINDOW } from "@/lib/whatsapp";
type Order={discount_paise?:number;offer_snapshot?:{title:string};id:string;order_number:string;status:string;fulfillment_method:string;total_paise:number;version:number;created_at:string;fulfillment_snapshot?:{name?:string;mobileE164?:string;address?:Record<string,string>}};
type Detail={order:Order;items:{id:string;raw_weight_grams:number|null;sale_quantity?:number;pricing_basis?:string;units_per_pack?:number;line_total_paise:number;instructions:string;product_snapshot:{productName:string;preparationName:string}}[];payments:{id:string;method:string;status:string;amountPaise:number;refundedPaise?:number;version:number}[];stock?:StockMove[]};
type StockMove={id:string;kind:"ORDER"|"CANCEL_RESTORE";productName:string;measure:"GRAMS"|"PACKS";change:number;before:number|null;after:number|null;note:string|null};
const stockAmount=(m:StockMove,n:number)=>m.measure==="GRAMS"?formatWeight(n):String(n);
/** "Seer Fish: −1 kg (3 kg → 2 kg)"; restores show "+", skipped restores show the note. */
function stockText(m:StockMove){return m.productName+": "+(m.change<0?"−":"+")+stockAmount(m,Math.abs(m.change))+(m.before!==null&&m.after!==null?" ("+stockAmount(m,m.before)+" → "+stockAmount(m,m.after)+")":"")+(m.note?" · "+m.note:"");}
const PAGE_SIZE=25;
const statusText:Record<string,string>={PLACED:"New",CONFIRMED:"Confirmed",PREPARING:"Preparing",READY:"Ready",OUT_FOR_DELIVERY:"Out for delivery",DELIVERED:"Delivered",CANCELLED:"Cancelled"};
const paymentText:Record<string,string>={PENDING:"Unpaid",VERIFYING:"Checking",PAID:"Paid",FAILED:"Failed",REFUNDED:"Refunded"};
const methodText:Record<string,string>={CASH:"Cash",UPI:"UPI",ONLINE:"Online"};
/** The one forward step staff take next; the database still validates every transition. */
function nextStep(o:Order):{status:string;label:string}|null {
 const pickup=o.fulfillment_method==="STORE_PICKUP";
 switch(o.status){
  case "PLACED":return {status:"CONFIRMED",label:"Confirm"};
  case "CONFIRMED":return {status:"PREPARING",label:"Start preparing"};
  case "PREPARING":return {status:"READY",label:"Mark ready"};
  case "READY":return pickup?{status:"DELIVERED",label:"Picked up"}:{status:"OUT_FOR_DELIVERY",label:"Out for delivery"};
  case "OUT_FOR_DELIVERY":return {status:"DELIVERED",label:"Delivered"};
  default:return null;
 }
}
const badge=(kind:string)=>"admin-badge badge-"+kind.toLowerCase().replaceAll("_","-");
type Item=Detail["items"][number];
const isWeighed=(i:Item)=>!i.pricing_basis||i.pricing_basis==="RAW_WEIGHT"||i.pricing_basis==="NET_WEIGHT";
function amountText(i:Item){
 if(i.pricing_basis==="TRAY")return i.sale_quantity+" tray"+(i.sale_quantity===1?"":"s")+" ("+(i.sale_quantity??0)*(i.units_per_pack??0)+" eggs)";
 if(i.pricing_basis==="UNIT")return i.sale_quantity+" unit"+(i.sale_quantity===1?"":"s");
 return formatWeight(Number(i.raw_weight_grams??i.sale_quantity??0))+(i.pricing_basis==="NET_WEIGHT"?" NET":" raw");
}
export async function Operations({token,context,store,orderId,section,before,cursor}:{token:string;context:StaffContext;store?:string;orderId?:string;section:string;before?:string;cursor?:string}){
 if(!store)return <p>No accessible stores.</p>;
 const validCursor=!!before&&Number.isFinite(Date.parse(before))&&/^[a-f0-9-]{36}$/i.test(cursor??"");
 const orders=await staffRpc<Order[]>(token,"order_queue_page",{target_store:store,row_limit:PAGE_SIZE,before_time:validCursor?before:null,before_id:validCursor?cursor:null});
 // The queue has no customer, items or payment, so each row reads its detail through the same permission-checked RPC.
 const details=await Promise.all(orders.map(o=>staffRpc<Detail>(token,"order_detail",{target_order:o.id}).catch(()=>null)));
 const base="/admin/"+context.role.toLowerCase()+"/"+section+"?store="+store;
 // Same page for every role; only the actions a role may take are shown. The database enforces them regardless.
 const manager=context.role!=="EMPLOYEE";
 // Customer site address for the tracking link in WhatsApp messages; the request's own host when NEXT_PUBLIC_SITE_URL is unset.
 const host=(await headers()).get("host");
 const site=process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/,"")||(host?(/^(localhost|127\.)/.test(host)?"http://":"https://")+host:"");
 const last=orders[orders.length-1];
 return <div className="ord-list">
  <p className="ord-intro">{orders.length?"Tap an order to see items, address and actions.":"No orders yet."}</p>
  {orders.map((o,index)=>{
   const d=details[index];
   const order=d?.order??o;
   const pickup=order.fulfillment_method==="STORE_PICKUP";
   const payment=d?.payments?.[d.payments.length-1];
   const customer=d?.order.fulfillment_snapshot;
   const address=deliveryAddress(customer?.address);
   const step=nextStep(order);
   const status=order.status==="DELIVERED"&&pickup?"Picked up":statusText[order.status]??order.status;
   const canCancel=manager&&!["DELIVERED","CANCELLED"].includes(order.status);
   const weighing=["PREPARING","READY","OUT_FOR_DELIVERY"].includes(order.status);
   return <details key={o.id} className="ord-row" open={o.id===orderId}>
    <summary>
     <span className="ord-line"><strong className="ord-number">{order.order_number}</strong><span className={badge(order.status)}>{status}</span><strong className="ord-total">{formatMoney(Number(order.total_paise))}</strong></span>
     <span className="ord-line ord-meta"><span>{customer?.name||"Customer"}</span><span>{d?d.items.length+" item"+(d.items.length===1?"":"s"):"…"}</span><span>{pickup?"Pickup":"Delivery"}</span>{payment&&<span className={badge(payment.status)}>{methodText[payment.method]??payment.method} · {paymentText[payment.status]??payment.status}</span>}</span>
    </summary>
    {!d?<p role="alert">Details unavailable. Reload the page.</p>:<div className="ord-body">
     {(step||canCancel)&&<div className="ord-actions">
      {step&&<OperationalForm operation="status" id={order.id} version={Number(order.version)} label={step.label} className="ord-form" buttonClassName="admin-button ord-primary"><input type="hidden" name="status" value={step.status}/></OperationalForm>}
      {canCancel&&<ActionDialog label="Cancel order" title={"Cancel "+order.order_number} triggerClassName="admin-button secondary ord-secondary"><OperationalForm operation="status" id={order.id} version={Number(order.version)} label="Cancel order"><input type="hidden" name="status" value="CANCELLED"/><label>Reason for cancelling<input name="reason" required maxLength={300}/></label></OperationalForm></ActionDialog>}
     </div>}
     {d.payments.map(p=><div key={p.id} className="ord-payment">
      <span className={badge(p.status)}>{methodText[p.method]??p.method} · {paymentText[p.status]??p.status}</span><span>{formatMoney(Number(p.amountPaise))}</span>
      {p.method==="CASH"&&p.status==="PENDING"&&order.status!=="CANCELLED"&&<OperationalForm operation="cash" id={p.id} version={Number(p.version)} label="Cash received" className="ord-form" buttonClassName="ord-small"/>}
      {p.method!=="CASH"&&["PENDING","VERIFYING","FAILED"].includes(p.status)&&order.status!=="CANCELLED"&&<ActionDialog label="Add UPI reference" title="UPI reference" triggerClassName="admin-text-button ord-link"><OperationalForm operation="reference" id={p.id} version={Number(p.version)} label="Submit reference"><label>Payment reference<input name="reference" maxLength={160} required/></label><p className="admin-muted">A reference never marks the payment as paid by itself.</p></OperationalForm></ActionDialog>}
      {manager&&p.status==="PAID"&&<ActionDialog label="Refund" title={"Refund for "+order.order_number} triggerClassName="admin-text-button ord-link"><OperationalForm operation="refund" id={p.id} version={Number(p.version)} label="Request refund"><input name="request" type="hidden" value={randomUUID()}/><label>What is refunded<select name="item"><option value="">Delivery fee</option>{d.items.map(i=><option key={i.id} value={i.id}>{i.product_snapshot.productName}</option>)}</select></label><label>Amount (₹)<input name="amountRupees" type="number" min="0.01" step="0.01" inputMode="decimal" required/></label><label>Reason<input name="reason" required maxLength={300}/></label><p className="admin-muted">This records a refund request; it does not send money.</p></OperationalForm></ActionDialog>}
     </div>)}
     <ul className="ord-items">{d.items.map(i=><li key={i.id}>
      <div className="ord-item-line"><span><strong>{i.product_snapshot.productName}</strong> · {i.product_snapshot.preparationName} · {amountText(i)}</span><span>{formatMoney(Number(i.line_total_paise))}</span></div>
      {i.instructions&&<p className="ord-note">Note: {i.instructions}</p>}
      {weighing&&isWeighed(i)&&<OperationalForm operation="weight" id={order.id} version={Number(order.version)} label="Save" className="ord-form ord-weight" buttonClassName="ord-small"><input type="hidden" name="item" value={i.id}/><label>Actual weight (g)<input name="grams" type="number" min="1" inputMode="numeric" required/></label></OperationalForm>}
     </li>)}</ul>
     {!!d.stock?.length&&<div className="ord-note"><strong>Stock impact</strong><ul>{d.stock.map(m=><li key={m.id}>{m.kind==="ORDER"?"Deducted":"Restored on cancel"} · {stockText(m)}</li>)}</ul></div>}
     {!!order.discount_paise&&<p className="ord-note">Offer {order.offer_snapshot?.title}: −{formatMoney(Number(order.discount_paise))}</p>}
     <div className="ord-customer">
      <p><strong>{customer?.name||"Customer"}</strong>{customer?.mobileE164&&<> · <a href={"tel:"+customer.mobileE164}>{customer.mobileE164}</a></>}</p>
      {customer?.mobileE164&&<a className="admin-button secondary ord-whatsapp" href={whatsappLink(customer.mobileE164,customerStatusMessage({name:customer.name,number:order.order_number,totalPaise:Number(order.total_paise),status:order.status,pickup,site}))} target={WHATSAPP_WINDOW}>WhatsApp customer</a>}
      {pickup?<p>Store pickup</p>:<><p>{address.line}</p>{address.landmark&&<p className="ord-note">Landmark: {address.landmark}</p>}</>}
      <p className="admin-muted">Placed {new Date(order.created_at).toLocaleString("en-IN",{timeZone:"Asia/Kolkata",dateStyle:"medium",timeStyle:"short"})}</p>
     </div>
     {manager&&d.payments.some(p=>p.status==="PAID"||p.status==="REFUNDED")&&<PaymentHistory token={token} order={order.id}/>}
    </div>}
   </details>;
  })}
  <nav aria-label="Order pages" className="ord-pages">{validCursor&&<Link href={base}>Latest orders</Link>}{orders.length===PAGE_SIZE&&last&&<Link href={base+"&before="+encodeURIComponent(last.created_at)+"&cursor="+last.id}>Older orders</Link>}</nav>
 </div>;
}
export async function BusinessPolicy({token}:{token:string}){
 const p=await staffRpc<{revision:number;employee_operational_history_days:number;employee_cash_collection_limit_paise:number|null;require_payment_before_completion:boolean;max_order_items:number;max_order_total_paise:number}|null>(token,"business_policy");
 return <section><h2>Business policy</h2>{!p&&<p>Configure approved values before checkout can operate.</p>}<OperationalForm operation="policy" version={Number(p?.revision??0)}>{([{name:"history",label:"Employee order history (days)",value:p?.employee_operational_history_days},{name:"cashLimit",label:"Employee cash limit (₹; blank disables collection)",value:p?.employee_cash_collection_limit_paise==null?null:p.employee_cash_collection_limit_paise/100,money:true},{name:"items",label:"Maximum items per order",value:p?.max_order_items},{name:"total",label:"Maximum order total (₹)",value:p?.max_order_total_paise==null?null:p.max_order_total_paise/100,money:true}]).map(f=><label key={f.name}>{f.label}<input type="number" min={f.money?"0.01":"1"} step={f.money?"0.01":"1"} inputMode={f.money?"decimal":"numeric"} name={f.name} defaultValue={f.value??""} required={f.name!=="cashLimit"}/></label>)}<label>Payment required before completion<select name="required" defaultValue={p?String(p.require_payment_before_completion):""} required><option value="" disabled>Select approved policy</option><option value="true">Yes</option><option value="false">No</option></select></label></OperationalForm></section>;
}
export async function Reports({token,store}:{token:string;store?:string}){
 if(!store)return <p>No accessible stores.</p>;
 const until=new Date(),from=new Date(until.getTime()-30*86400000);
 const r=await staffRpc<{orders:{count:number;intakePaise:number;fulfilledPaise:number;cancelled:number};payments:{method:string;status:string;count:number;amountPaise:number;refundedPaise:number}[]}>(token,"integration_report",{target_store:store,from_date:from.toISOString(),until_date:until.toISOString()});
 return <section><h2>Orders placed in the past 30 days</h2><p>Current fulfillment and payment states for this order cohort. This is not a settlement-date collection report.</p><dl><dt>Orders</dt><dd>{r.orders.count}</dd><dt>Order intake</dt><dd>{formatMoney(Number(r.orders.intakePaise))}</dd><dt>Fulfilled sales</dt><dd>{formatMoney(Number(r.orders.fulfilledPaise))}</dd><dt>Cancellations</dt><dd>{r.orders.cancelled}</dd></dl>{r.payments.map(p=><p key={p.method+p.status}>{p.method} · {p.status}: {p.count} payments · {formatMoney(Number(p.amountPaise))} · Refunded {formatMoney(Number(p.refundedPaise))}</p>)}</section>;
}

export async function PaymentHistory({token,order}:{token:string;order:string}){
 const h=await staffRpc<{payments:{id:string;method:string}[];refunds:{id:string;payment_id:string;status:string;amount_paise:number;version:number}[];events:{id:string;kind:string;to_status:string;created_at:string}[]}>(token,"payment_history",{target_order:order});
 return <section><h2>Payment history</h2><ul>{h.events.map(e=><li key={e.id}>{e.kind.replaceAll("_"," ")} · {e.to_status} · {new Date(e.created_at).toLocaleString("en-IN",{timeZone:"Asia/Kolkata"})}</li>)}</ul><h3>Refunds</h3>{h.refunds.map(r=><div key={r.id}><p>{r.status} · {formatMoney(Number(r.amount_paise))}</p>{r.status==="PENDING"&&h.payments.some(p=>p.id===r.payment_id&&p.method==="CASH")&&<OperationalForm operation="cash-refund" id={r.id} version={Number(r.version)} label="Confirm cash refund handed over"/>}</div>)}</section>;
}
