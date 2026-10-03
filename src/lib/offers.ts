import "server-only";
import { publicRpc } from "./supabase";
import { productCategoryChains } from "./live-catalogue";
import type { CartOffer } from "./cart-offer";
export type CurrentOffer = {id:string;title:string;message:string;code?:string;kind:"PERCENT"|"FIXED";value:number;endsAt:string;scope:string;products:string[];categories:string[];targetNames:string[]};
export async function currentOffers():Promise<CurrentOffer[]> {
 const store=process.env.TRAIT_STORE_ID;
 return store ? publicRpc<CurrentOffer[]>("store_offers",{target_store:store}) : [];
}
/** Active offers with their coupon codes and the products each covers, for the cart and checkout coupon list. */
export async function cartOffers():Promise<CartOffer[]> {
 const offers=(await currentOffers()).filter(o=>o.code);
 if(!offers.length) return [];
 const chains=offers.some(o=>o.scope==="CATEGORIES")?await productCategoryChains():{};
 return offers.map(o=>({id:o.id,title:o.title,code:o.code!,kind:o.kind,value:o.value,
  condition:o.scope==="STORE"?"Valid on all items":"Valid on "+(o.targetNames?.length?o.targetNames.join(", "):"selected items")+" only",
  productIds:o.scope==="STORE"?"ALL":o.scope==="PRODUCTS"?o.products:Object.keys(chains).filter(id=>chains[id].some(c=>o.categories.includes(c)))}));
}
