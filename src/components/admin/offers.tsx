import { staffRpc } from "@/lib/admin/server";
import { formatDateTimeIST } from "@/lib/format";
import type { StaffRole } from "@/lib/admin/permissions";
import type { CurrentOffer } from "@/lib/offers";
import { OfferList } from "@/components/offers/offer-list";
import { OfferControls,OfferForm,type OfferRecord } from "./offer-form";
/** Offers whose end time has passed (checked when the page is rendered on the server). */
function endedOffers(offers:OfferRecord[]){const now=Date.now();return new Set(offers.filter(o=>Date.parse(o.ends_at)<=now).map(o=>o.id));}
export async function OffersWorkspace({token,role,store}:{token:string;role:StaffRole;store?:string}) {
 if(!store)return <p>No accessible stores. Offers require an existing store.</p>;
 const data=await staffRpc<{offers?:OfferRecord[];current?:CurrentOffer[];products:{id:string;name:string}[];categories:{id:string;name:string}[]}>(token,"offer_workspace",{target_store:store});
 const imageBase=process.env.SUPABASE_URL?process.env.SUPABASE_URL+"/storage/v1/object/public/offer-images/":undefined;
 if(role==="EMPLOYEE")return data.current?.length?<OfferList offers={data.current}/>:<p>No current offers for this store.</p>;
 const offers=data.offers??[],live=offers.filter(o=>!o.archived_at),deleted=offers.filter(o=>o.archived_at);
 const ended=endedOffers(live),status=(o:OfferRecord)=>ended.has(o.id)?"Ended":o.is_active?"Active schedule":"Inactive";
 return <><details><summary>Create offer</summary><OfferForm key={store} store={store} products={data.products} categories={data.categories} imageBase={imageBase}/></details>
  {live.map(o=><details key={o.id+":"+o.version}><summary>{o.title} · {o.code} · {status(o)}</summary><OfferControls offer={o} store={store} ended={ended.has(o.id)}/><OfferForm offer={o} store={store} products={data.products} categories={data.categories} imageBase={imageBase}/></details>)}
  {deleted.length>0&&<details><summary>Show deleted ({deleted.length})</summary><p className="admin-muted">Deleted offers never apply and keep their codes reserved.</p>{deleted.map(o=><div key={o.id+":"+o.version} className="admin-offer-deleted"><p><strong>{o.title}</strong> · {o.code} · deleted {formatDateTimeIST(o.archived_at!)}</p><OfferControls offer={o} store={store}/></div>)}</details>}</>;
}
