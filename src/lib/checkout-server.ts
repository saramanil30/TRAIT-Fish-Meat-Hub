import "server-only";
import postgres from "postgres";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { SUPABASE_ROOT_CA } from "@/lib/supabase-ca";
let pool: ReturnType<typeof postgres> | undefined;
function db() {
 const url=process.env.TRAIT_CHECKOUT_DATABASE_URL;
 if (!url) throw new Error("Checkout connection is not configured.");
 return pool??=postgres(url,{ssl:{rejectUnauthorized:true,ca:SUPABASE_ROOT_CA},max:3,prepare:false,connect_timeout:10,idle_timeout:20});
}
function key() {
 const value=process.env.TRAIT_CHECKOUT_ENVELOPE_KEY;
 if(!value||!/^[a-f0-9]{64}$/i.test(value)) throw new Error("Checkout encryption is not configured.");
 return Buffer.from(value,"hex");
}
export function seal(value:unknown) {
 const iv=randomBytes(12), cipher=createCipheriv("aes-256-gcm",key(),iv);
 const encrypted=Buffer.concat([cipher.update(JSON.stringify(value),"utf8"),cipher.final()]);
 return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString("base64url");
}
export function unseal<T>(value:string):T {
 if(typeof value!=="string"||value.length>100000) throw new Error("Invalid checkout.");
 const bytes=Buffer.from(value,"base64url"), decipher=createDecipheriv("aes-256-gcm",key(),bytes.subarray(0,12));
 decipher.setAuthTag(bytes.subarray(12,28));
 return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString("utf8"));
}
/** Logs why a checkout step failed: error class, code and a redacted message only, never payloads or secrets. */
export function logCheckoutFailure(stage:string, cause:unknown) {
 const error=cause instanceof Error?cause:new Error(String(cause));
 const code=typeof cause==="object"&&cause&&"code" in cause?String(cause.code):undefined;
 const message=error.message.replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi,"<url>").replace(/\b(bearer|password|token)([=:\s]+)\S+/gi,"$1$2<redacted>").slice(0,300);
 console.error("[checkout] "+stage+" failed",{name:error.name,...(code?{code}:{}),message});
}
/** Atomic distributed limiter. Production fails closed if it is unconfigured. */
/** Limits per client IP, or per `subject` (e.g. a mobile number; only its hash is stored). */
export async function rateLimit(scope:string, limit:number, subject?:string) {
 const url=process.env.TRAIT_RATE_LIMIT_REST_URL, token=process.env.TRAIT_RATE_LIMIT_REST_TOKEN;
 if(!url||!token) throw new Error("Request protection is not configured.");
 if(new URL(url).protocol!=="https:") throw new Error("Invalid limiter configuration.");
 const h=await headers();
 // Set this header at a trusted ingress; do not accept arbitrary forwarded headers.
 const header=process.env.TRAIT_TRUSTED_IP_HEADER;
 const ip=header?h.get(header):null;
 const identity=createHash("sha256").update(subject!==undefined?"subject:"+subject:ip??"shared").digest("hex");
 const script="local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],60) end; return n";
 const response=await fetch(url,{method:"POST",cache:"no-store",signal:AbortSignal.timeout(5000),headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify(["EVAL",script,"1","trait:"+scope+":"+identity])});
 if(!response.ok) throw new Error("Request protection unavailable.");
 const result=await response.json();
 if(!Number.isInteger(result.result)||result.result>limit) throw new Error("Too many requests. Please wait a minute.");
}
export type Quote={discountPaise?:number;offer?:{title:string;code?:string}|null;quoteDigest:string;subtotalPaise:number;deliveryFeePaise:number;totalPaise:number;items:{lineTotalPaise:number;pricePerKgPaise:number|null;pricePaise?:number}[]};
export type Envelope={store:string;requestId:string;payload:Record<string,unknown>;digest:string;token:string;trackingExpires:string;reviewExpires:number};
export async function quoteOrder(payload:Record<string,unknown>) {
 const store=process.env.TRAIT_STORE_ID;
 const days=Number(process.env.TRAIT_TRACKING_EXPIRY_DAYS);
 if(!store||!Number.isInteger(days)||days<1||days>365) throw new Error("Ordering policy is not configured.");
 const sql=await checkoutDatabase();
 // ::text first: with prepare:false, postgres.js sends a bare ::jsonb string parameter as a JSON string, not an object.
 const rows=await sql`select api.checkout_quote(${store}::uuid,${JSON.stringify(payload)}::text::jsonb) as result`;
 const quote=rows[0].result as Quote;
 const envelope:Envelope={store,requestId:randomUUID(),payload,digest:quote.quoteDigest,token:randomBytes(32).toString("hex"),trackingExpires:new Date(Date.now()+days*86400000).toISOString(),reviewExpires:Date.now()+15*60000};
 return {envelope:seal(envelope),discountPaise:quote.discountPaise??0,offer:quote.offer??null,subtotalPaise:quote.subtotalPaise,deliveryChargePaise:quote.deliveryFeePaise,grandTotalPaise:quote.totalPaise,lines:quote.items.map(i=>({lineTotalPaise:i.lineTotalPaise,pricePerKg:(i.pricePerKgPaise??0)/100}))};
}
export async function commitOrder(value:string) {
 const e=unseal<Envelope>(value);
 if(e.store!==process.env.TRAIT_STORE_ID) throw new Error("Review a fresh quote.");
 const sql=await checkoutDatabase(), digest=createHash("sha256").update(e.token).digest("hex");
 await sql`select api.place_order(${e.store}::uuid,${e.requestId}::uuid,${JSON.stringify(e.payload)}::text::jsonb,${e.digest},${digest},${e.trackingExpires}::timestamptz)`;
 return {trackingToken:e.token};
}

export type OpenOrder={orderNumber:string;placedAt:string;status:string;totalPaise:number;history:{status:string;at:string}[]|null};
/** Open orders for a normalized +91 mobile at this store. Status data only; call after rate limiting. */
export async function openOrdersByMobile(mobileE164:string):Promise<OpenOrder[]> {
 const store=process.env.TRAIT_STORE_ID;
 if(!store) throw new Error("Store is not configured.");
 const sql=await checkoutDatabase();
 const rows=await sql`select api.open_orders_by_mobile(${store}::uuid,${mobileE164}::text) as result`;
 return rows[0].result as OpenOrder[];
}
async function checkoutDatabase() {
 const sql=db();
 const rows=await sql`select (not r.rolsuper and not r.rolbypassrls and not r.rolcreaterole
 and pg_has_role(current_user,'trait_checkout','USAGE')
 and not pg_has_role(current_user,'trait_payment_verifier','USAGE')
 and not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='app' and c.relkind='r' and has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE'))) as allowed
 from pg_roles r where r.rolname=current_user`;
 if(rows[0]?.allowed!==true) throw new Error("Checkout requires its isolated least-privilege connection.");
 return sql;
}
