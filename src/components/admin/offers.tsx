import { staffRpc } from "@/lib/admin/server";
import type { StaffRole } from "@/lib/admin/permissions";
import type { CurrentOffer } from "@/lib/offers";
import { OfferList } from "@/components/offers/offer-list";
import { OfferForm,type OfferRecord } from "./offer-form";
export async function OffersWorkspace({token,role,store}:{token:string;role:StaffRole;store?:string}) {
 if(!store)return <p>No accessible stores. Offers require an existing store.</p>;
 const data=await staffRpc<{offers?:OfferRecord[];current?:CurrentOffer[];products:{id:string;name:string}[];categories:{id:string;name:string}[]}>(token,"offer_workspace",{target_store:store});
 const imageBase=process.env.SUPABASE_URL?process.env.SUPABASE_URL+"/storage/v1/object/public/offer-images/":undefined;
 if(role==="EMPLOYEE")return data.current?.length?<OfferList offers={data.current}/>:<p>No current offers for this store.</p>;
 return <><details><summary>Create offer</summary><OfferForm key={store} store={store} products={data.products} categories={data.categories} imageBase={imageBase}/></details>{data.offers?.map(o=><details key={o.id+":"+o.version}><summary>{o.title} · {o.is_active?"Active schedule":"Inactive"}</summary><OfferForm offer={o} store={store} products={data.products} categories={data.categories} imageBase={imageBase}/></details>)}</>;
}
