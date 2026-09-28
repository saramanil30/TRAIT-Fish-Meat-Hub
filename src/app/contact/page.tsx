import type { Metadata } from "next";
import { storefrontInfo } from "@/lib/storefront-info";
export const metadata:Metadata={title:"Contact the store"};
export default async function Page(){
 const store=await storefrontInfo();
 return <section className="container page-section"><h1>Contact the store</h1>{store?<><h2>{store.name}</h2><p>{Object.values(store.address).join(", ")}</p>{store.phone&&<p><a href={"tel:"+store.phone}>{store.phone}</a></p>}<h2>Opening hours</h2><p>Times in {store.timezone}. Unlisted days are closed.</p><dl>{Object.entries(store.hours).map(([day,slots])=><div key={day}><dt>{day.toUpperCase()}</dt><dd>{slots.length?slots.map(s=>s.opens+" ? "+s.closes).join(", "):"Closed"}</dd></div>)}</dl></>:<p>Store contact information is currently unavailable.</p>}</section>;
}
