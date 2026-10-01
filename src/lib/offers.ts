import "server-only";
import { publicRpc } from "./supabase";
export type CurrentOffer = {id:string;title:string;message:string;kind:"PERCENT"|"FIXED";value:number;endsAt:string;scope:string;targetNames:string[]};
export async function currentOffers():Promise<CurrentOffer[]> {
 const store=process.env.TRAIT_STORE_ID;
 return store ? publicRpc<CurrentOffer[]>("store_offers",{target_store:store}) : [];
}
