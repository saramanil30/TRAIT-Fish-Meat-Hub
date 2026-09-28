"use server";
import { quoteOrder,commitOrder,rateLimit } from "@/lib/checkout-server";
import type { CheckoutDetails } from "@/types/order";
import type { CartItem } from "@/types/cart";
import { normalizeMobile,validateCheckout } from "@/lib/order";
export async function reviewCheckout(items:readonly CartItem[], details:CheckoutDetails) {
 try {
  await rateLimit("checkout",20);
  if(!Array.isArray(items)||!items.length||items.length>100||JSON.stringify({items,details}).length>100000||Object.keys(validateCheckout(details)).length) throw new Error("Invalid checkout.");
  const payload={items:items.map(i=>({productId:i.productId,preparationId:i.preparationId,rawWeightGrams:i.rawWeightGrams,instructions:i.specialInstructions.normalize("NFC").trim()})),method:details.deliveryMethod==="delivery"?"HOME_DELIVERY":"STORE_PICKUP",mobile:normalizeMobile(details.mobile),name:details.name.trim()||null,paymentMethod:details.paymentMethod==="cash"?"CASH":"UPI",address:details.deliveryMethod==="delivery"?{line1:details.address.trim(),...(details.landmark.trim()?{line2:details.landmark.trim()}:{}),locality:details.locality.trim(),city:details.city?.trim(),state:details.state?.trim(),pincode:details.pincode.trim(),countryCode:"IN"}:null};
  return {quote:await quoteOrder(payload)};
 } catch {return {error:"Unable to quote this order. Check delivery details and product availability, or contact the store."};}
}
export async function placeCheckout(envelope:string) {
 try {await rateLimit("place",10);return await commitOrder(envelope);}
 catch (cause) {const reviewRequired=!!cause&&typeof cause==="object"&&"code" in cause&&["40001","22023"].includes(String(cause.code));return {reviewRequired,error:reviewRequired?"Prices or availability changed. Please review your order again.":"Order could not be confirmed. Retry with the same review."};}
}
