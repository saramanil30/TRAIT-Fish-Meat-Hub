"use server";
import { quoteOrder,commitOrder,rateLimit,logCheckoutFailure } from "@/lib/checkout-server";
import type { CheckoutDetails } from "@/types/order";
import type { CartItem } from "@/types/cart";
import { normalizeMobile,validateCheckout,SERVICE_CITY,SERVICE_STATE } from "@/lib/order";
import { COUPON_PATTERN } from "@/lib/cart-offer";
/** "Delivery slot unavailable: closed | full | date | choose a slot" from the database. */
function slotError(cause:unknown){const match=cause instanceof Error?/^Delivery slot unavailable: (.+)$/.exec(cause.message):null;if(!match)return null;return match[1]==="choose a slot"?"Choose a delivery slot, then continue.":match[1]==="full"?"That slot just filled up. Choose another slot.":"That slot is no longer available. Choose another slot.";}
/** The database names the product when stock runs short: "Not enough stock for Seer Fish". */
function stockError(cause:unknown){const match=cause instanceof Error?/^Not enough stock for (.{1,160})$/.exec(cause.message):null;return match?"Only a limited quantity of "+match[1]+" is left. Reduce the quantity or remove it, then review again.":null;}
export async function reviewCheckout(items:readonly CartItem[], details:CheckoutDetails, couponCode:string|null=null) {
 try {
  await rateLimit("checkout",20);
  if(!Array.isArray(items)||!items.length||items.length>100||JSON.stringify({items,details}).length>100000||Object.keys(validateCheckout(details)).length||(couponCode!==null&&!COUPON_PATTERN.test(String(couponCode)))) throw new Error("Invalid checkout.");
  const payload={items:items.map(i=>({productId:i.productId,preparationId:i.preparationId,...(i.quantity!==undefined?{quantity:i.quantity}:{rawWeightGrams:i.rawWeightGrams}),instructions:i.specialInstructions.normalize("NFC").trim()})),method:details.deliveryMethod==="delivery"?"HOME_DELIVERY":"STORE_PICKUP",mobile:normalizeMobile(details.mobile),name:details.name.trim()||null,paymentMethod:details.paymentMethod==="cash"?"CASH":"UPI",address:details.deliveryMethod==="delivery"?{line1:details.address.trim(),...(details.landmark.trim()?{line2:details.landmark.trim()}:{}),locality:details.locality.trim(),/* fixed server-side, never from the browser */city:SERVICE_CITY,state:SERVICE_STATE,pincode:details.pincode.trim(),countryCode:"IN"}:null,...(details.slotId&&details.slotDate?{slot:{id:details.slotId,date:details.slotDate}}:{}),...(couponCode?{couponCode}:{})};
  return {quote:await quoteOrder(payload)};
 } catch (cause) {logCheckoutFailure("quote",cause);const stock=stockError(cause)??slotError(cause);if(stock)return {error:stock};if(couponCode&&cause instanceof Error&&cause.message.includes("Coupon"))return {error:"Coupon "+couponCode+" can’t be applied to this order. Remove it or choose another coupon."};return {error:"Unable to quote this order. Check delivery details and product availability, or contact the store."};}
}
export async function placeCheckout(envelope:string) {
 try {await rateLimit("place",10);return await commitOrder(envelope);}
 catch (cause) {logCheckoutFailure("place",cause);const reviewRequired=!!cause&&typeof cause==="object"&&"code" in cause&&["40001","22023"].includes(String(cause.code));return {reviewRequired,error:stockError(cause)??slotError(cause)??(reviewRequired?"Prices or availability changed. Please review your order again.":"Order could not be confirmed. Retry with the same review.")};}
}
