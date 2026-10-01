"use server";
import { revalidatePath } from "next/cache";
import { requireStaff,staffRpc } from "@/lib/admin/server";
import type { ActionState } from "./actions";
export async function saveOffer(_:ActionState,form:FormData):Promise<ActionState> {
 try {
  const {token,context}=await requireStaff("offers");
  if(context.role!=="OWNER"&&context.role!=="ADMIN") return {error:"Only OWNER and ADMIN can manage offers."};
  const text=(key:string)=>String(form.get(key)??"");
  const kind=text("kind"),raw=text("amount");
  if(!/^\d{1,7}(\.\d{1,2})?$/.test(raw)) return {error:"Enter a positive discount with at most two decimal places."};
  const amount=Math.round(Number(raw)*100);
  if(amount<1||amount>(kind==="PERCENT"?10000:100000000)) return {error:"Enter a percentage up to 100 or a fixed discount up to ₹1,000,000."};
  const start=new Date(text("start")+"Z"),end=new Date(text("end")+"Z");
  if(!Number.isFinite(start.getTime())||!Number.isFinite(end.getTime())||end<=start) return {error:"End date must be after start date (UTC)."};
  const scope=text("scope");
  await staffRpc(token,"save_offer",{target_id:text("id")||null,target_store:text("store"),expected_version:Number(text("version"))||null,
   offer_title:text("title").trim(),offer_message:text("message").trim(),kind,amount,start_time:start.toISOString(),end_time:end.toISOString(),target_scope:scope,
   products:scope==="PRODUCTS"?form.getAll("products").map(String):[],categories:scope==="CATEGORIES"?form.getAll("categories").map(String):[],active:text("active")==="true"});
  revalidatePath("/");revalidatePath("/admin","layout");return {success:"Offer saved. Checkout uses current eligibility."};
 } catch {return {error:"Unable to save. Check the fields and store access, or reload if this offer changed."};}
}
