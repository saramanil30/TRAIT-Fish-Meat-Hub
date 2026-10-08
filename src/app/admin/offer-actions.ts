"use server";
import { revalidatePath } from "next/cache";
import { requireStaff,staffRpc,uploadOfferImage,validProductWebp } from "@/lib/admin/server";
import type { ActionState } from "./actions";
/** Optional whole-rupee field → paise; "" → null. Undefined means invalid. */
function rupeesToPaise(raw:string){
 if(!raw.trim())return null;
 if(!/^\d{1,7}$/.test(raw.trim()))return undefined;
 return Number(raw.trim())*100;
}
/** An India-time instant from a date and optional "HH:MM" (the store is in Asia/Kolkata: UTC+05:30, no daylight saving).
 *  A blank time means the start or the end of that day (00:00 or 23:59). */
function istInstant(date:string,time:string,edge:"start"|"end"){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||(time&&!/^\d{2}:\d{2}$/.test(time)))return new Date(NaN);
 // The end is exclusive, so "23:59" (typed or blank) keeps the whole last minute.
 const clock=edge==="start"?(time||"00:00")+":00":!time||time==="23:59"?"23:59:59":time+":00";
 return new Date(date+"T"+clock+"+05:30");
}
export async function saveOffer(_:ActionState,form:FormData):Promise<ActionState> {
 try {
  const {token,context}=await requireStaff("offers");
  if(context.role!=="OWNER"&&context.role!=="ADMIN") return {error:"Only OWNER and ADMIN can manage offers."};
  const text=(key:string)=>String(form.get(key)??"");
  const kind=text("kind"),raw=text("amount").trim(),code=text("code").trim().toUpperCase();
  if(kind!=="PERCENT"&&kind!=="FIXED") return {error:"Choose a discount type."};
  if(!/^[A-Z0-9]{3,20}$/.test(code)) return {error:"Enter a coupon code of 3–20 letters or numbers."};
  // Percent is stored in basis points (10% → 1000); a flat amount is whole rupees stored in paise.
  if(kind==="PERCENT"?!/^\d{1,3}(\.\d{1,2})?$/.test(raw):!/^\d{1,7}$/.test(raw)) return {error:kind==="PERCENT"?"Enter a percentage with at most two decimal places.":"Enter the flat discount in whole rupees."};
  const amount=Math.round(Number(raw)*100);
  if(amount<1||amount>(kind==="PERCENT"?10000:100000000)) return {error:kind==="PERCENT"?"Enter a percentage between 0.01 and 100.":"Enter a flat discount between ₹1 and ₹10,00,000."};
  const minOrder=rupeesToPaise(text("minOrder")),maxDiscount=kind==="PERCENT"?rupeesToPaise(text("maxDiscount")):null;
  if(minOrder===undefined) return {error:"Enter the minimum order in whole rupees, or leave it blank."};
  if(maxDiscount===undefined||maxDiscount===0) return {error:"Enter the maximum discount in whole rupees (at least ₹1), or leave it blank."};
  const start=istInstant(text("startDate"),text("startTime"),"start"),end=istInstant(text("endDate"),text("endTime"),"end");
  if(!Number.isFinite(start.getTime())||!Number.isFinite(end.getTime())||end<=start) return {error:"End date must be after start date (IST)."};
  // Banner: a new upload replaces the current one; "Remove" clears it; otherwise the current one stays.
  const file=form.get("imageFile");
  let image:string|null=text("removeImage")==="true"?null:text("image")||null;
  if(file instanceof File&&file.size>0){
   const bytes=new Uint8Array(await file.arrayBuffer());
   if(!validProductWebp(bytes)) return {error:"The banner must be a WebP image under 1 MB."};
   try{image=await uploadOfferImage(token,context.businessId,bytes);}
   catch{return {error:"The banner image could not be uploaded, so the offer was not saved. Check the offer image storage setup and try again."};}
  }
  const scope=text("scope");
  await staffRpc(token,"save_offer",{target_id:text("id")||null,target_store:text("store"),expected_version:Number(text("version"))||null,
   offer_title:text("title").trim(),offer_message:text("message").trim(),kind,amount,start_time:start.toISOString(),end_time:end.toISOString(),target_scope:scope,
   products:scope==="PRODUCTS"?form.getAll("products").map(String):[],categories:scope==="CATEGORIES"?form.getAll("categories").map(String):[],active:text("active")==="true",offer_code:code,
   min_order:minOrder??0,max_discount:maxDiscount,image});
  revalidatePath("/");revalidatePath("/admin","layout");return {success:"Offer saved. Checkout uses current eligibility."};
 } catch (cause) {return {error:cause instanceof Error&&cause.message.startsWith("That code")?cause.message:"Unable to save. Check the fields and store access, or reload if this offer changed."};}
}
