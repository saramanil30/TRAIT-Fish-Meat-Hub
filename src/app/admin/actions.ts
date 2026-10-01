"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { authRequest, requireStaff, resolveStaff, sessionCookie, refreshCookie, saveStaffSession, clearStaffSession, staffRpc } from "@/lib/admin/server";
import { parseDailyPrice } from "@/lib/admin/permissions";
export type ActionState = { error?: string; success?: string };
const text = (form: FormData, name: string) => String(form.get(name) ?? "");
function uuid(value: string) { if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new Error("Invalid record."); return value; }
function boolean(form: FormData, name: string) { const value=text(form,name); if (!["true","false"].includes(value)) throw new Error("Invalid availability."); return value==="true"; }
export async function signIn(_state: ActionState, form: FormData): Promise<ActionState> {
 let destination: string;
 try {
  // Supabase Auth enforces password-grant rate limits independently of checkout.
  const email=text(form,"email").trim(); const password=text(form,"password");
  if (email.length > 254 || !email.includes("@") || !password || password.length>1024) return {error:"Unable to sign in. Check your credentials and active staff access."};
  const response=await authRequest("token?grant_type=password",{method:"POST",body:JSON.stringify({email,password})});
  if (response.status===429) return {error:"Too many sign-in attempts. Please try again later."};
  if (!response.ok) return {error:"Unable to sign in. Check your credentials and active staff access."};
  const session=await response.json();
  const context=await resolveStaff(session.access_token);
  await saveStaffSession(session);
  destination="/admin/"+context.role.toLowerCase()+"/dashboard";
 } catch { return {error:"Unable to sign in. Check your credentials and active staff access."}; }
 redirect(destination);
}
export async function refreshStaffSession(resume=false): Promise<ActionState> {
 let destination="";
 try {
  const refresh=(await cookies()).get(refreshCookie)?.value;
  if(!refresh)throw new Error("No session.");
  const response=await authRequest("token?grant_type=refresh_token",{method:"POST",body:JSON.stringify({refresh_token:refresh})});
  if(!response.ok)throw new Error("Expired session.");
  const session=await response.json();
  const context=await resolveStaff(session.access_token);
  await saveStaffSession(session);
  destination="/admin/"+context.role.toLowerCase()+"/dashboard";
 } catch {
  await clearStaffSession();
  return {error:"Your session has ended. Please sign in again."};
 }
 if(resume)redirect(destination);
 return {success:"Session renewed."};
}
export async function signOut() {
 const jar=await cookies(); let token=jar.get(sessionCookie)?.value;
 try {
  if(!token&&jar.get(refreshCookie)?.value){
   const response=await authRequest("token?grant_type=refresh_token",{method:"POST",body:JSON.stringify({refresh_token:jar.get(refreshCookie)!.value})});
   if(response.ok)token=(await response.json()).access_token;
  }
  if(token)await authRequest("logout?scope=local",{method:"POST",headers:{Authorization:"Bearer "+token}});
 } catch { /* Clear this browser's cookies even when Auth is unreachable. */ }
 await clearStaffSession();redirect("/admin");
}
export async function saveDailyProduct(_state: ActionState,form: FormData): Promise<ActionState> {
 try {
  const {token}=await requireStaff("prices");
  const version=Number(text(form,"version"));
  if (!Number.isSafeInteger(version)||version<1) throw new Error("Reload the product.");
  await staffRpc(token,"update_daily_product",{offering:uuid(text(form,"id")),expected_version:version,price_paise:parseDailyPrice(text(form,"price")),is_available:boolean(form,"available")});
  revalidatePath("/admin","layout"); return {success:"Price and availability saved."};
 } catch(error) { return {error:error instanceof Error ? error.message : "Unable to save."}; }
}
export async function saveMaster(_state: ActionState,form: FormData): Promise<ActionState> {
 try {
  const {token}=await requireStaff("catalogue");
  const kind=text(form,"kind"); const id=text(form,"id");
  if (kind==="category") {
   const parent=text(form,"parent");
   await staffRpc(token,"save_category",{target_id:id?uuid(id):null,category_name:text(form,"name"),parent:parent?uuid(parent):null,sort:Number(text(form,"sort")),active:boolean(form,"active")});
  } else if(kind==="product") {
   await staffRpc(token,"save_product",{target_id:id?uuid(id):null,category:uuid(text(form,"category")),product_name:text(form,"name"),local_name:text(form,"local"),description:text(form,"description"),image_path:text(form,"image"),weights:JSON.parse(text(form,"weights")),preparation_choices:JSON.parse(text(form,"preparations")),active:boolean(form,"active")});
  } else if(kind==="pricing") {
   const quantities=text(form,"quantities").split(",").map(v=>Number(v.trim()));
   if(!quantities.length||quantities.some(v=>!Number.isSafeInteger(v)||v<1))throw new Error("Invalid quantities");
   await staffRpc(token,"configure_product_pricing",{product:uuid(id),basis:text(form,"basis"),unit_grams:text(form,"unitGrams")?Number(text(form,"unitGrams")):null,pack_count:text(form,"packCount")?Number(text(form,"packCount")):null,quantities,reference_price:text(form,"referencePrice")?parseDailyPrice(text(form,"referencePrice")):null,published:boolean(form,"published")});
  } else if(kind==="offering") {
   await staffRpc(token,"create_offering",{product:uuid(text(form,"product")),target_store:uuid(text(form,"store"))});
  } else throw new Error("Invalid operation.");
  revalidatePath("/admin","layout"); return {success:"Catalogue saved."};
 } catch { return {error:"Unable to save. Check the fields, permissions, and existing records."}; }
}
export async function saveEmployeeAccess(_state: ActionState,form: FormData): Promise<ActionState> {
 try {
  const {token}=await requireStaff("employees");
  await staffRpc(token,"set_employee_access",{employee:uuid(text(form,"id")),active:boolean(form,"active")});
  revalidatePath("/admin","layout"); return {success:"Employee access updated."};
 } catch { return {error:"Employee access could not be updated."}; }
}
export async function saveStoreOperations(_state: ActionState,form: FormData): Promise<ActionState> {
 try {
  const {token}=await requireStaff("settings");
  await staffRpc(token,"save_store_operations",{target_store:uuid(text(form,"store")),store_name:text(form,"name").trim(),delivery:boolean(form,"delivery"),pickup:boolean(form,"pickup"),hours:JSON.parse(text(form,"hours"))});
  revalidatePath("/admin","layout"); return {success:"Store settings saved."};
 } catch { return {error:"Unable to save store settings. Check opening hours and your access."}; }
}
