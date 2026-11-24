import "server-only";
import postgres from "postgres";
import { createHmac, timingSafeEqual } from "node:crypto";
import { SUPABASE_ROOT_CA } from "@/lib/supabase-ca";
import { logCheckoutFailure } from "@/lib/checkout-server";

/**
 * Razorpay (test mode first). Keys live only in env: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET.
 * Every database write here goes through TRAIT_PAYMENT_VERIFIER_DATABASE_URL, a separate LOGIN that is a
 * member of trait_payment_verifier only. Only the signed webhook marks payments PAID; the browser's
 * Checkout callback is never trusted.
 */
function keys() {
 const keyId=process.env.RAZORPAY_KEY_ID, secret=process.env.RAZORPAY_KEY_SECRET;
 if(!keyId||!secret||!/^rzp_(test|live)_[A-Za-z0-9]{6,40}$/.test(keyId)) throw new Error("Online payments are not configured.");
 return {keyId,secret};
}
/** Whether checkout may offer "Pay online": keys and the verifier connection are configured. */
export function onlinePaymentsEnabled() {
 return !!(process.env.RAZORPAY_KEY_ID&&process.env.RAZORPAY_KEY_SECRET&&process.env.RAZORPAY_WEBHOOK_SECRET&&process.env.TRAIT_PAYMENT_VERIFIER_DATABASE_URL&&process.env.TRAIT_STORE_ID);
}

let pool:ReturnType<typeof postgres>|undefined;
async function verifierDatabase() {
 const url=process.env.TRAIT_PAYMENT_VERIFIER_DATABASE_URL;
 if(!url) throw new Error("Payment verifier connection is not configured.");
 if(url===process.env.TRAIT_CHECKOUT_DATABASE_URL) throw new Error("The payment verifier must use its own database login.");
 const sql=pool??=postgres(url,{ssl:{rejectUnauthorized:true,ca:SUPABASE_ROOT_CA},max:3,prepare:false,connect_timeout:10,idle_timeout:20});
 const rows=await sql`select (not r.rolsuper and not r.rolbypassrls and not r.rolcreaterole
 and pg_has_role(current_user,'trait_payment_verifier','USAGE')
 and not pg_has_role(current_user,'trait_checkout','USAGE')
 and not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='app' and c.relkind='r' and has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE'))) as allowed
 from pg_roles r where r.rolname=current_user`;
 if(rows[0]?.allowed!==true) throw new Error("Payment verification requires its isolated least-privilege connection.");
 return sql;
}
function store() {
 const id=process.env.TRAIT_STORE_ID;
 if(!id) throw new Error("Store is not configured.");
 return id;
}
async function accountId(sql:Awaited<ReturnType<typeof verifierDatabase>>) {
 const rows=await sql`select api.razorpay_account(${store()}::uuid,${keys().keyId}) as id`;
 return rows[0].id as string;
}

/** Server-to-server Razorpay REST call with basic auth. */
async function razorpay<T>(path:string,body:Record<string,unknown>,extraHeaders:Record<string,string>={}):Promise<T> {
 const {keyId,secret}=keys();
 const response=await fetch("https://api.razorpay.com/v1"+path,{method:"POST",cache:"no-store",signal:AbortSignal.timeout(15000),
  headers:{Authorization:"Basic "+Buffer.from(keyId+":"+secret).toString("base64"),"Content-Type":"application/json",...extraHeaders},body:JSON.stringify(body)});
 const result=await response.json().catch(()=>({}));
 if(!response.ok) throw new Error("Razorpay "+path.split("/")[1]+" failed: "+String(result?.error?.code??response.status)+" "+String(result?.error?.description??"").slice(0,160));
 return result as T;
}

type OnlinePayment={paymentId:string;orderId:string;orderNumber:string;amountPaise:number;currency:string;status:string;orderStatus:string;providerReference:string|null;payUntil:string;name:string|null;mobileE164:string|null};
export type CheckoutStart={keyId:string;razorpayOrderId:string;amountPaise:number;currency:string;orderNumber:string;name:string|null;contact:string|null;timeoutSeconds:number};
export type PaymentStart={start:CheckoutStart}|{state:"PAID"|"CANCELLED"|"EXPIRED"|"UNAVAILABLE"};

/** Opens (or reopens, for "Retry payment") Razorpay Checkout for one online payment. The Razorpay order
 *  amount comes from our server-side quote stored on the payment, never from the browser. */
export async function startOnlinePayment(paymentId:string):Promise<PaymentStart> {
 if(!/^[0-9a-f-]{36}$/i.test(paymentId)) return {state:"UNAVAILABLE"};
 const sql=await verifierDatabase();
 await sql`select api.cancel_unpaid_online_orders(${store()}::uuid)`;
 const load=async()=>(await sql`select api.online_payment(${store()}::uuid,${paymentId}::uuid) as p`)[0].p as OnlinePayment|null;
 let p=await load();
 if(!p) return {state:"UNAVAILABLE"};
 if(p.status==="PAID"||p.status==="REFUNDED") return {state:"PAID"};
 if(p.orderStatus==="CANCELLED") return {state:"CANCELLED"};
 const left=Math.floor((Date.parse(p.payUntil)-Date.now())/1000);
 // Leave a minute so Checkout closes before the order is cancelled.
 if(left<90) return {state:"EXPIRED"};
 if(!p.providerReference) {
  const account=await accountId(sql);
  const order=await razorpay<{id:string;amount:number;currency:string}>("/orders",{amount:Number(p.amountPaise),currency:p.currency,receipt:p.orderNumber,notes:{trait_payment:p.paymentId,trait_order:p.orderNumber}});
  if(order.amount!==Number(p.amountPaise)||order.currency!==p.currency) throw new Error("Razorpay order amount mismatch.");
  try {await sql`select api.bind_provider_payment(${p.paymentId}::uuid,${account}::uuid,${order.id})`;}
  catch(cause){logCheckoutFailure("razorpay-bind",cause);} // A concurrent start bound first; use whichever is bound.
  p=await load();
  if(!p?.providerReference) return {state:"UNAVAILABLE"};
 }
 return {start:{keyId:keys().keyId,razorpayOrderId:p.providerReference,amountPaise:Number(p.amountPaise),currency:p.currency,orderNumber:p.orderNumber,name:p.name,contact:p.mobileE164,timeoutSeconds:left-60}};
}

/** Signed pay link for WhatsApp: /pay/<payment id>.<signature>. Opens Checkout for that payment only. */
export function payLinkPath(paymentId:string) {
 return "/pay/"+paymentId+"."+createHmac("sha256",keys().secret).update("trait-pay:"+paymentId).digest("base64url").slice(0,32);
}
export function verifyPayLink(value:string):string|null {
 const match=/^([0-9a-f-]{36})\.([A-Za-z0-9_-]{32})$/i.exec(value);
 if(!match) return null;
 const expected=Buffer.from(payLinkPath(match[1]).split(".")[1]), given=Buffer.from(match[2]);
 return expected.length===given.length&&timingSafeEqual(expected,given)?match[1]:null;
}

/** Razorpay webhook signature: hex HMAC-SHA256 of the raw body with the webhook secret. */
export function verifyWebhookSignature(rawBody:string,signature:string|null) {
 const secret=process.env.RAZORPAY_WEBHOOK_SECRET;
 if(!secret||!signature||!/^[a-f0-9]{64}$/i.test(signature)) return false;
 const expected=Buffer.from(createHmac("sha256",secret).update(rawBody,"utf8").digest("hex")), given=Buffer.from(signature.toLowerCase());
 return expected.length===given.length&&timingSafeEqual(expected,given);
}

type Entity={id:string;order_id?:string|null;payment_id?:string;amount:number;currency:string;status:string;notes?:Record<string,string>|unknown[]};
type WebhookEvent={event:string;payload:{payment?:{entity:Entity};refund?:{entity:Entity}}};
/** Applies one verified webhook event. "ignored" for events we do not act on or do not recognise. */
export async function applyWebhookEvent(event:WebhookEvent,eventId:string):Promise<"applied"|"ignored"> {
 const sql=await verifierDatabase();
 const account=await accountId(sql);
 const payment=event.payload.payment?.entity, refund=event.payload.refund?.entity;
 try {
  if((event.event==="payment.captured"||event.event==="payment.failed")&&payment?.order_id) {
   await sql`select api.record_razorpay_payment(${account}::uuid,${payment.order_id},${payment.id},${eventId},${event.event==="payment.captured"?"PAID":"FAILED"},${payment.amount}::bigint,${payment.currency})`;
   return "applied";
  }
  if((event.event==="refund.processed"||event.event==="refund.failed")&&refund) {
   const notes=refund.notes&&!Array.isArray(refund.notes)?refund.notes as Record<string,string>:{};
   const order=payment?.order_id??notes.razorpay_order;
   if(!order) return "ignored";
   await sql`select api.record_verified_refund(${account}::uuid,${order},${refund.id},${eventId},${event.event==="refund.processed"?"COMPLETED":"FAILED"},${refund.amount}::bigint,${refund.currency})`;
   return "applied";
  }
  return "ignored";
 } catch(cause) {
  // Business rejections (unknown order from another environment, a failure after capture, replay with
  // different data) are final: acknowledge so Razorpay stops retrying. Connection errors propagate and retry.
  if(typeof cause==="object"&&cause&&"code" in cause&&String(cause.code)==="22023") {logCheckoutFailure("razorpay-webhook "+event.event,cause);return "ignored";}
  throw cause;
 } finally {
  await sql`select api.cancel_unpaid_online_orders(${store()}::uuid)`.catch(cause=>logCheckoutFailure("razorpay-sweep",cause));
 }
}

/** After staff created the refund (ADMIN/OWNER, audited): send it to Razorpay and bind its id.
 *  The refund completes only when the signed refund.processed webhook arrives. */
export async function sendRefundToRazorpay(refund:{refundId:string;amountPaise:number;chargeReference:string;providerRefundReference:string|null;razorpayOrder:string}) {
 if(refund.providerRefundReference) return;
 const result=await razorpay<{id:string;amount:number}>("/payments/"+encodeURIComponent(refund.chargeReference)+"/refund",
  {amount:refund.amountPaise,speed:"normal",receipt:refund.refundId,notes:{trait_refund:refund.refundId,razorpay_order:refund.razorpayOrder}},
  {"X-Refund-Idempotency":refund.refundId});
 if(result.amount!==refund.amountPaise) throw new Error("Razorpay refund amount mismatch.");
 const sql=await verifierDatabase();
 await sql`select api.bind_provider_refund(${refund.refundId}::uuid,${result.id})`;
}
