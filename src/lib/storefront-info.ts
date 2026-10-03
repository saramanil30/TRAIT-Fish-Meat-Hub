import "server-only";
import { publicRpc } from "./supabase";
export type StorefrontInfo={name:string;address:Record<string,string>;phone:string|null;whatsapp?:string|null;pickupInstructions?:string|null;timezone:string;hours:Record<string,{opens:string;closes:string}[]>;pickup:boolean;delivery:boolean;areas:{pincode:string;name:string;feePaise:number;minimumPaise:number}[]};
export async function storefrontInfo():Promise<StorefrontInfo|null>{
 if(!process.env.TRAIT_STORE_ID)return null;
 try{return await publicRpc<StorefrontInfo|null>("storefront_info",{target_store:process.env.TRAIT_STORE_ID});}catch{return null;}
}
/** Delivery fee to show before a pincode is known: the store's delivery-area fee (lowest when areas differ), or null when delivery is off. */
export async function storeDeliveryFee():Promise<{feePaise:number|null;varies:boolean}>{
 const info=await storefrontInfo();
 const fees=info?.delivery?(info.areas??[]).map(a=>Number(a.feePaise)).filter(Number.isSafeInteger):[];
 return {feePaise:fees.length?Math.min(...fees):null,varies:new Set(fees).size>1};
}
// The RPC returns a JSON object, whose key order is not the postal order.
export function storeAddress(a:Record<string,string>){return ["line1","line2","locality","city","state","pincode"].map(k=>a[k]).filter(Boolean).join(", ");}
export const WEEK_DAYS=["mon","tue","wed","thu","fri","sat","sun"];
const DAY_NAMES:Record<string,string>={mon:"Mon",tue:"Tue",wed:"Wed",thu:"Thu",fri:"Fri",sat:"Sat",sun:"Sun"};
/** "07:00" → "7:00 AM". */
export function clockTime(value:string){const [h,m]=value.split(":").map(Number);if(!Number.isFinite(h)||!Number.isFinite(m))return value;return (h%12||12)+":"+String(m).padStart(2,"0")+" "+(h<12?"AM":"PM");}
/** Opening hours as short lines: "Open daily, 7:00 AM – 8:30 PM" when every day matches, otherwise one line per day. */
export function hoursLines(hours:StorefrontInfo["hours"]):string[]{
 const slot=(d:string)=>(hours[d]??[]).map(s=>clockTime(s.opens)+" – "+clockTime(s.closes)).join(", ")||"Closed";
 const all=WEEK_DAYS.map(slot);
 if(all.every(s=>s===all[0]))return [all[0]==="Closed"?"Closed":"Open daily, "+all[0]];
 return WEEK_DAYS.map((d,i)=>DAY_NAMES[d]+": "+all[i]);
}
/** Digits only, with the India country code, for wa.me and tel: links. */
export function phoneDigits(value:string){const digits=value.replace(/\D/g,"");return digits.length===10?"91"+digits:digits;}
