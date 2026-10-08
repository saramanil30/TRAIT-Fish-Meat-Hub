import "server-only";
import { publicRpc } from "./supabase";
import { productCategoryChains } from "./live-catalogue";
import { formatMoney } from "./format";
import type { CartOffer } from "./cart-offer";
export type CurrentOffer = {id:string;title:string;message:string;code?:string;kind:"PERCENT"|"FIXED";value:number;endsAt:string;scope:string;products:string[];categories:string[];targetNames:string[];minOrderPaise?:number;maxDiscountPaise?:number|null;imagePath?:string|null;imageUrl?:string|null};
const imageUrl=(path?:string|null)=>path&&process.env.SUPABASE_URL?process.env.SUPABASE_URL+"/storage/v1/object/public/offer-images/"+path.split("/").map(encodeURIComponent).join("/"):null;
export async function currentOffers():Promise<CurrentOffer[]> {
 const store=process.env.TRAIT_STORE_ID;
 return store ? (await publicRpc<CurrentOffer[]>("store_offers",{target_store:store})).map(o=>({...o,imageUrl:imageUrl(o.imagePath)})) : [];
}
/** "On all items", "On Seafood & Prawns", "On Rohu, Katla & Prawns". */
export function offerScope(o:CurrentOffer){
 const names=o.targetNames??[];
 if(o.scope==="STORE")return "On all items";
 if(!names.length)return "On selected items";
 return "On "+(names.length===1?names[0]:names.slice(0,-1).join(", ")+" & "+names[names.length-1]);
}
/** "On orders above ₹999" plus "· up to ₹200 off", or null when the offer has neither. */
export function offerTerms(o:CurrentOffer){
 const terms=[o.minOrderPaise?"On orders above "+formatMoney(o.minOrderPaise):"",o.kind==="PERCENT"&&o.maxDiscountPaise?"Up to "+formatMoney(o.maxDiscountPaise)+" off":""].filter(Boolean);
 return terms.length?terms.join(" · "):null;
}
/** Active offers with their coupon codes and the products each covers, for the cart and checkout coupon list. */
export async function cartOffers():Promise<CartOffer[]> {
 const offers=(await currentOffers()).filter(o=>o.code);
 if(!offers.length) return [];
 const chains=offers.some(o=>o.scope==="CATEGORIES")?await productCategoryChains():{};
 return offers.map(o=>({id:o.id,title:o.title,code:o.code!,kind:o.kind,value:o.value,minOrderPaise:Number(o.minOrderPaise??0),maxDiscountPaise:o.maxDiscountPaise==null?null:Number(o.maxDiscountPaise),
  condition:[o.scope==="STORE"?"Valid on all items":offerScope(o).replace(/^On /,"Valid on ")+" only",offerTerms(o)].filter(Boolean).join(" · "),
  productIds:o.scope==="STORE"?"ALL":o.scope==="PRODUCTS"?o.products:Object.keys(chains).filter(id=>chains[id].some(c=>o.categories.includes(c)))}));
}
