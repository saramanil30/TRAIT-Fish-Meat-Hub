"use server";
import { rateLimit } from "@/lib/checkout-server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { authRequest, requireStaff, resolveStaff, sessionCookie, staffRpc } from "@/lib/admin/server";
import { parseDailyPrice } from "@/lib/admin/permissions";
export type ActionState = { error?: string; success?: string };
const text = (form: FormData, name: string) => String(form.get(name) ?? "");
function uuid(value: string) { if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new Error("Invalid record."); return value; }
function boolean(form: FormData, name: string) { const value=text(form,name); if (!["true","false"].includes(value)) throw new Error("Invalid availability."); return value==="true"; }
export async function signIn(_state: ActionState, form: FormData): Promise<ActionState> {
 let destination: string;
 try {
  await rateLimit("staff-login",10);
  const email=text(form,"email").trim(); const password=text(form,"password");
  if (email.length > 254 || !email.includes("@") || !password || password.length>1024) return {error:"Unable to sign in. Check your credentials and active staff access."};
  const response=await authRequest("token?grant_type=password",{method:"POST",body:JSON.stringify({email,password})});
  if (!response.ok) return {error:"Unable to sign in. Check your credentials and active staff access."};
  const session=await response.json();
  const context=await resolveStaff(session.access_token);
  const age=Math.max(1,Math.min(Number(session.expires_in)||3600,3600));
  (await cookies()).set(sessionCookie,session.access_token,{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"strict",path:"/admin",maxAge:age});
  destination="/admin/"+context.role.toLowerCase()+"/dashboard";
 } catch { return {error:"Unable to sign in. Check your credentials and active staff access."}; }
 redirect(destination);
}
export async function signOut() {
 const jar=await cookies(); const token=jar.get(sessionCookie)?.value;
 if (token) await authRequest("logout",{method:"POST",headers:{Authorization:"Bearer "+token}}).catch(()=>undefined);
 jar.delete({name:sessionCookie,path:"/admin"}); redirect("/admin");
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
