"use server";
import { requireStaff, staffRpc, authRequest } from "@/lib/admin/server";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { dispatchRestockPushes } from "@/lib/restock-server";
import { rateLimit } from "@/lib/checkout-server";
import { rupeesToPaise } from "@/lib/admin/permissions";
import { sendRefundToRazorpay } from "@/lib/razorpay";
import type { ActionState } from "./actions";
const text=(f:FormData,k:string)=>String(f.get(k)??"");
const id=(f:FormData,k:string)=>{const s=text(f,k);if(!/^[a-f0-9-]{36}$/i.test(s))throw new Error("Invalid identity");return s;};
const number=(f:FormData,k:string)=>{const n=Number(text(f,k));if(!Number.isSafeInteger(n)||n<0)throw new Error("Invalid number");return n;};
const rupees=(f:FormData,k:string)=>rupeesToPaise(text(f,k));
export async function operationalAction(_:ActionState,f:FormData):Promise<ActionState>{
 try{
  const kind=text(f,"operation");
  const {token}=await requireStaff(["policy","delivery","slot"].includes(kind)?"settings":["provision","staff-profile","recovery"].includes(kind)?"employees":["refund","cash-refund","online-refund"].includes(kind)?"payments":"orders");
  if(kind==="status"){
   // Cancel dialog: a preset reason, or "Other" with the staff member's own words.
   const reason=text(f,"reason")==="Other"?text(f,"reasonOther").trim():text(f,"reason");
   if(text(f,"status")==="CANCELLED"&&!reason)return {error:"Choose a reason, or describe it under Other."};
   await staffRpc(token,"transition_order",{target_order:id(f,"id"),expected_version:number(f,"version"),next_status:text(f,"status"),reason:reason||null});
   // A cancellation can return stock and make a sold-out product available again.
   if(text(f,"status")==="CANCELLED")after(dispatchRestockPushes);
  }
  else if(kind==="cash")await staffRpc(token,"receive_cash",{target_payment:id(f,"id"),expected_version:number(f,"version")});
  else if(kind==="reference")await staffRpc(token,"submit_payment_reference",{target_payment:id(f,"id"),expected_version:number(f,"version"),reference:text(f,"reference")});
  else if(kind==="weight")await staffRpc(token,"record_fulfilled_weight",{target_order:id(f,"id"),target_item:id(f,"item"),expected_version:number(f,"version"),actual_grams:number(f,"grams")});
  else if(kind==="refund")await staffRpc(token,"request_refund",{target_payment:id(f,"id"),expected_version:number(f,"version"),request_key:id(f,"request"),reason:text(f,"reason"),allocations:[{itemId:text(f,"item")||null,amountPaise:text(f,"amountRupees")?rupees(f,"amountRupees"):number(f,"amount")}]});
  else if(kind==="online-refund"){
   // One click, ADMIN/OWNER only (checked and audited by the database), full remaining amount back via Razorpay.
   const reason=text(f,"reason").trim()||"Refunded by store";
   const refund=await staffRpc<{refundId:string;amountPaise:number;chargeReference:string;razorpayOrder:string;providerRefundReference:string|null}>(token,"request_full_online_refund",{target_payment:id(f,"id"),expected_version:number(f,"version"),request_key:id(f,"request"),reason});
   try{await sendRefundToRazorpay(refund);}
   catch(cause){console.error("[admin] razorpay refund failed:",cause instanceof Error?cause.message:cause);revalidatePath("/admin","layout");return {error:"The refund was recorded but Razorpay did not accept it yet. Reload and press Refund again to retry; it will not refund twice."};}
   revalidatePath("/admin","layout");
   return {success:"Refund sent to Razorpay. It shows as completed when Razorpay confirms it (usually within minutes)."};
  }
  else if(kind==="cash-refund")await staffRpc(token,"complete_cash_refund",{target_refund:id(f,"id"),expected_version:number(f,"version")});
  else if(kind==="delivery"){
   // "Add" with a pincode that already has a rule updates that rule; pincodes are unique per store.
   const store=id(f,"store"),pincode=text(f,"pincode").trim();
   const existing=text(f,"id")?null:(await staffRpc<{id:string;pincode:string;version:number}[]>(token,"delivery_areas",{target_store:store})).find(a=>a.pincode===pincode);
   const target=text(f,"id")?{id:id(f,"id"),version:number(f,"version")}:existing?{id:existing.id,version:Number(existing.version)}:null;
   // Via Rapido adds ₹0 to our total (the database stores 0 regardless); estimate and advance apply to Rapido only.
   const mode=text(f,"mode")==="RAPIDO"?"RAPIDO":"SHOP",rapido=mode==="RAPIDO";
   await staffRpc(token,"save_delivery_area",{target_id:target?.id??null,target_store:store,expected_version:target?.version??null,area_pincode:pincode,area_name:text(f,"name"),fee_paise:rapido?0:rupees(f,"fee"),minimum_paise:rupees(f,"minimum"),active:text(f,"active")==="true",
    mode,estimate:rapido?text(f,"estimate").replace(/\s+/g," ").trim().slice(0,120)||null:null,advance_required:rapido&&text(f,"advance")==="true"});
  }
  else if(kind==="rapido-link"){
   // ADMIN/OWNER only (the database checks the role, store access and that it is a Rapido order); blank clears the link.
   if((await requireStaff("orders")).context.role==="EMPLOYEE")throw new Error("Forbidden");
   const link=text(f,"link").trim();
   if(link&&(link.length>500||new URL(link).protocol!=="https:"))return {error:"Paste the Rapido tracking link starting with https://."};
   await staffRpc(token,"set_rapido_tracking",{target_order:id(f,"id"),link_url:link||null});
   revalidatePath("/admin","layout");
   return {success:link?"Rapido tracking link saved. It shows on the customer's tracking page and in WhatsApp messages.":"Rapido tracking link removed."};
  }
  else if(kind==="slot"){
   // Times arrive as "HH:MM" from time inputs; api.save_delivery_slot checks ADMIN/OWNER, store access, order of times and capacity.
   const hhmm=(k:string)=>{const v=text(f,k).slice(0,5);if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(v))throw new Error("Invalid time");return v;};
   await staffRpc(token,"save_delivery_slot",{target_store:id(f,"store"),target_slot:text(f,"id")?id(f,"id"):null,expected_version:number(f,"version"),slot_name:text(f,"name").replace(/\s+/g," ").trim(),starts:hhmm("starts"),ends:hhmm("ends"),cutoff:hhmm("cutoff"),capacity:number(f,"max"),active:text(f,"active")==="true"});
  }
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
  else if(kind==="policy")await staffRpc(token,"save_business_policy",{expected_revision:number(f,"version"),history_days:number(f,"history"),cash_limit:text(f,"cashLimit").trim()?rupees(f,"cashLimit"):null,payment_required:text(f,"required")==="true",item_limit:number(f,"items"),total_limit:rupees(f,"total")});
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
 }catch(error){
  console.error("[admin] operation failed:",text(f,"operation"),error instanceof Error?error.message:error);
  return {error:"Unable to save. Check your access, configured policy and fields, then reload if another person updated this record."};
 }
}
