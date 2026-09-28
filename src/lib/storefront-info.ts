import "server-only";
import { publicRpc } from "./supabase";
export type StorefrontInfo={name:string;address:Record<string,string>;phone:string|null;timezone:string;hours:Record<string,{opens:string;closes:string}[]>;pickup:boolean;delivery:boolean;areas:{pincode:string;name:string;feePaise:number;minimumPaise:number}[]};
export async function storefrontInfo():Promise<StorefrontInfo|null>{
 if(!process.env.TRAIT_STORE_ID)return null;
 try{return await publicRpc<StorefrontInfo|null>("storefront_info",{target_store:process.env.TRAIT_STORE_ID});}catch{return null;}
}
