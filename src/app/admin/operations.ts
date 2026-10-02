"use server";
import { requireStaff, staffRpc, authRequest } from "@/lib/admin/server";
import { revalidatePath } from "next/cache";
import { rateLimit } from "@/lib/checkout-server";
import type { ActionState } from "./actions";
const text=(f:FormData,k:string)=>String(f.get(k)??"");
const id=(f:FormData,k:string)=>{const s=text(f,k);if(!/^[a-f0-9-]{36}$/i.test(s))throw new Error("Invalid identity");return s;};
const number=(f:FormData,k:string)=>{const n=Number(text(f,k));if(!Number.isSafeInteger(n)||n<0)throw new Error("Invalid number");return n;};
const rupees=(f:FormData,k:string)=>{const s=text(f,k).trim();if(!/^\d{1,9}(\.\d{1,2})?$/.test(s))throw new Error("Invalid amount");return Math.round(Number(s)*100);};
export async function operationalAction(_:ActionState,f:FormData):Promise<ActionState>{
 try{
  const kind=text(f,"operation");
  const {token}=await requireStaff(["policy","delivery"].includes(kind)?"settings":["provision","staff-profile","recovery"].includes(kind)?"employees":["refund","cash-refund"].includes(kind)?"payments":"orders");
  if(kind==="status")await staffRpc(token,"transition_order",{target_order:id(f,"id"),expected_version:number(f,"version"),next_status:text(f,"status"),reason:text(f,"reason")||null});
  else if(kind==="cash")await staffRpc(token,"receive_cash",{target_payment:id(f,"id"),expected_version:number(f,"version")});
  else if(kind==="reference")await staffRpc(token,"submit_payment_reference",{target_payment:id(f,"id"),expected_version:number(f,"version"),reference:text(f,"reference")});
  else if(kind==="weight")await staffRpc(token,"record_fulfilled_weight",{target_order:id(f,"id"),target_item:id(f,"item"),expected_version:number(f,"version"),actual_grams:number(f,"grams")});
  else if(kind==="refund")await staffRpc(token,"request_refund",{target_payment:id(f,"id"),expected_version:number(f,"version"),request_key:id(f,"request"),reason:text(f,"reason"),allocations:[{itemId:text(f,"item")||null,amountPaise:text(f,"amountRupees")?rupees(f,"amountRupees"):number(f,"amount")}]});
  else if(kind==="cash-refund")await staffRpc(token,"complete_cash_refund",{target_refund:id(f,"id"),expected_version:number(f,"version")});
  else if(kind==="delivery") await staffRpc(token,"save_delivery_area",{target_id:text(f,"id")?id(f,"id"):null,target_store:id(f,"store"),expected_version:text(f,"id")?number(f,"version"):null,area_pincode:text(f,"pincode"),area_name:text(f,"name"),fee_paise:number(f,"fee"),minimum_paise:number(f,"minimum"),active:text(f,"active")==="true"});
  else if(kind==="staff-profile") await staffRpc(token,"save_staff_profile",{target_staff:id(f,"id"),expected_version:number(f,"version"),staff_name:text(f,"name"),store_ids:f.getAll("stores").map(String),active:text(f,"active")==="true"});
  else if(kind==="recovery"){
   await rateLimit("staff-recovery",5);
   const directory=await staffRpc<{id:string;authUserId:string;active:boolean;role:string}[]>(token,"staff_directory");
   const target=directory.find(s=>s.id===text(f,"id")&&s.active&&s.role!=="ADMIN");
   if(!target)throw new Error("Forbidden");
   const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_AUTH_ADMIN_KEY,redirect=process.env.TRAIT_AUTH_RECOVERY_URL;
   if(!url||!key||!redirect||new URL(redirect).protocol!=="https:")throw new Error("Recovery not configured");
   const response=await fetch(new URL("/auth/v1/admin/users/"+target.authUserId,url),{cache:"no-store",signal:AbortSignal.timeout(15000),headers:{apikey:key,Authorization:"Bearer "+key}});
   if(!response.ok)throw new Error("Identity unavailable");
   const user=await response.json();
   const recovery=await authRequest("recover?redirect_to="+encodeURIComponent(redirect),{method:"POST",body:JSON.stringify({email:user.email})});
   if(!recovery.ok)throw new Error("Recovery unavailable");
   return {success:"Password recovery email requested."};
  }
  else if(kind==="policy")await staffRpc(token,"save_business_policy",{expected_revision:number(f,"version"),history_days:number(f,"history"),cash_limit:text(f,"cashLimit")?number(f,"cashLimit"):null,payment_required:text(f,"required")==="true",item_limit:number(f,"items"),total_limit:number(f,"total")});
  else if(kind==="provision"){
   await rateLimit("staff-provision",5);
   const email=text(f,"email").trim(),name=text(f,"name").trim(),role=text(f,"role");
   const {context}=await requireStaff("employees");
   if(role!=="EMPLOYEE"&&(role!=="OWNER"||context.role!=="ADMIN"))throw new Error("Forbidden");
   if(!context.stores.some(s=>s.id===text(f,"store"))||!email.includes("@")||email.length>254||!name||name.length>160)throw new Error("Invalid staff");
   const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_AUTH_ADMIN_KEY,redirect=process.env.TRAIT_AUTH_RECOVERY_URL;
   if(!url||!key||!redirect||new URL(redirect).protocol!=="https:")throw new Error("Auth administration not configured");
   const response=await fetch(new URL("/auth/v1/invite?redirect_to="+encodeURIComponent(redirect!),url),{method:"POST",cache:"no-store",signal:AbortSignal.timeout(15000),headers:{apikey:key,Authorization:"Bearer "+key,"Content-Type":"application/json"},body:JSON.stringify({email})});
   if(!response.ok)throw new Error("Auth identity could not be created");
   const user=await response.json();
   // An unbound identity has no TRAIT access if provisioning fails. Do not delete users automatically.
   await staffRpc(token,"provision_staff",{auth_identity:user.id,staff_name:name,staff_role:role,assigned_store:id(f,"store")});
   revalidatePath("/admin","layout");
   return {success:"Staff invitation sent and membership created. The recipient can set their own password using the invitation link."};
  } else throw new Error("Invalid operation");
  revalidatePath("/admin","layout");return {success:"Saved."};
 }catch{return {error:"Unable to save. Check your access, configured policy and fields, then reload if another person updated this record."};}
}
