"use server";
import { logCheckoutFailure, openOrdersByMobile, rateLimit, type OpenOrder } from "@/lib/checkout-server";
import { normalizeMobile } from "@/lib/order";

export type LookupState={orders?:OpenOrder[];message?:string};
/** One message for no orders, invalid input, rate limits and outages, so a lookup never reveals which applied. */
const GENERIC="No open orders to show for this number. Check the number and try again, or open the tracking link from your order confirmation.";

export async function lookupOrders(_state:LookupState, form:FormData):Promise<LookupState> {
 try {
  await rateLimit("order-lookup-ip",5);
  const digits=normalizeMobile(String(form.get("mobile")??"").slice(0,20));
  if(!/^[6-9]\d{9}$/.test(digits)) return {message:GENERIC};
  const mobile="+91"+digits;
  await rateLimit("order-lookup-number",3,mobile);
  const orders=await openOrdersByMobile(mobile);
  return orders.length?{orders}:{message:GENERIC};
 } catch(cause) {
  logCheckoutFailure("order lookup",cause);
  return {message:GENERIC};
 }
}
