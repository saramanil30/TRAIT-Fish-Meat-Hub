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
