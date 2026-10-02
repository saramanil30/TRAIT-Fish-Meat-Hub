import "server-only";
import { cookies } from "next/headers";
import { createHash } from "node:crypto";
import { staffRoles, type StaffRole, type StaffSection, canAccessSection } from "./permissions";
export type StaffContext = { id: string; businessId: string; role: StaffRole; name: string; stores: { id: string; name: string }[] };
export const sessionCookie = "trait_staff_access";
export const refreshCookie = "trait_staff_refresh";
export function staffConfigured() { return process.env.TRAIT_STAFF_ENABLED !== "false" && !!process.env.SUPABASE_URL && !!process.env.SUPABASE_PUBLISHABLE_KEY; }
function config() {
 if (!staffConfigured()) throw new Error("Staff sign-in is not configured.");
 const url = new URL(process.env.SUPABASE_URL!);
 if (url.protocol !== "https:") throw new Error("Supabase requires HTTPS.");
 return { url: url.origin, key: process.env.SUPABASE_PUBLISHABLE_KEY! };
}
export async function authRequest(path: string, init: RequestInit) {
 const {url,key} = config();
 return fetch(url + "/auth/v1/" + path, { ...init, cache: "no-store", signal: AbortSignal.timeout(15000), headers: { apikey: key, "Content-Type": "application/json", ...init.headers } });
}
export async function staffRpc<T>(token: string, name: string, args: Record<string, unknown> = {}): Promise<T> {
 const {url,key} = config();
 const response = await fetch(url + "/rest/v1/rpc/" + name, { method: "POST", cache: "no-store", signal: AbortSignal.timeout(15000), headers: { apikey: key, Authorization: "Bearer " + token, "Content-Type": "application/json", "Content-Profile": "api", "Accept-Profile": "api" }, body: JSON.stringify(args) });
 if (!response.ok) {
  const failure = await response.json().catch(() => ({}));
  if (failure.code === "40001") throw new Error("This product changed. Reload the page before saving again.");
  throw new Error("Operation unavailable or not permitted.");
 }
 const text = await response.text();
 return (text ? JSON.parse(text) : null) as T;
}
export async function resolveStaff(token: string): Promise<StaffContext> {
 const user = await authRequest("user", { headers: { Authorization: "Bearer " + token } });
 if (!user.ok) throw new Error("Sign in again.");
 const context = await staffRpc<StaffContext>(token,"staff_context");
 if (!context || !staffRoles.includes(context.role) || !context.id || !Array.isArray(context.stores)) throw new Error("Staff access denied.");
 return context;
}
export async function requireStaff(section?: StaffSection) {
 const token = (await cookies()).get(sessionCookie)?.value;
 if (!token) throw new Error("Sign in again.");
 const context = await resolveStaff(token);
 if (section && !canAccessSection(context.role,section)) throw new Error("Access denied.");
 return { token, context };
}

export function recoveryRedirect() {
 const value=process.env.TRAIT_AUTH_RECOVERY_URL;
 if(!value) throw new Error("Password recovery is temporarily unavailable. Contact your store manager.");
 const url=new URL(value);
 const local=process.env.NODE_ENV!=="production" && ["localhost","127.0.0.1"].includes(url.hostname);
 if((url.protocol!=="https:" && !(local&&url.protocol==="http:")) || url.username || url.password || url.pathname!=="/admin/recovery" || url.search || url.hash) throw new Error("Invalid recovery destination.");
 return url.href;
}
export async function saveStaffSession(session:{access_token:string;refresh_token?:string;expires_in:number}) {
 if(typeof session.access_token!=="string"||!session.access_token)throw new Error("Invalid session.");
 const maxAge=Math.max(1,Math.min(Number(session.expires_in)||3600,3600));
 const jar=await cookies();
 const options={httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"strict" as const,path:"/admin"};
 jar.set(sessionCookie,session.access_token,{...options,maxAge});
 if(session.refresh_token)jar.set(refreshCookie,session.refresh_token,options);
 else jar.delete({name:refreshCookie,path:"/admin"});
 return maxAge;
}
export async function clearStaffSession() {
 const jar=await cookies();
 jar.delete({name:sessionCookie,path:"/admin"});
 jar.delete({name:refreshCookie,path:"/admin"});
}
/** Product photos: WebP only, at most 1 MB, stored at {business}/{product}/{sha256}.webp (matches app.product_images). */
export const productImageLimitBytes = 1048576;
export function validProductWebp(bytes: Uint8Array) {
 const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
 return bytes.length >= 16 && bytes.length <= productImageLimitBytes && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
}
export async function uploadProductImage(token: string, businessId: string, productId: string, alt: string, bytes: Uint8Array) {
 if (!validProductWebp(bytes)) throw new Error("Upload a JPEG, PNG or WebP photo under 1 MB after conversion.");
 const {url,key} = config();
 const hash = createHash("sha256").update(bytes).digest("hex");
 const path = businessId + "/" + productId + "/" + hash + ".webp";
 // The staff session uploads; Storage policies decide who may write to the bucket.
 const response = await fetch(url + "/storage/v1/object/product-images/" + path, { method: "POST", cache: "no-store", signal: AbortSignal.timeout(30000), headers: { apikey: key, Authorization: "Bearer " + token, "Content-Type": "image/webp", "x-upsert": "false" }, body: Buffer.from(bytes) });
 // A 409 means identical bytes were already uploaded for this product.
 const duplicate = response.status === 409 || (!response.ok && String((await response.clone().json().catch(() => ({}))).statusCode) === "409");
 if (!response.ok && !duplicate) throw new Error("Photo upload is not available. Check the product image storage setup.");
 await staffRpc(token, "save_product_image", { target_id: null, product: productId, local_asset: null, bucket: "product-images", object_path: path, alternate_text: alt, primary_image: true, active: true, display_order: 0 });
}
