import type { Metadata } from "next";
import { storefrontInfo } from "@/lib/storefront-info";
import { formatMoney } from "@/lib/format";
export const metadata:Metadata={title:"Delivery and pickup"};
export default async function Page(){const store=await storefrontInfo();return <section className="container page-section"><h1>Delivery and pickup</h1>{store?<><h2>{store.name}</h2><p>{store.pickup?"Store pickup is available at "+Object.values(store.address).join(", "):"Store pickup is currently unavailable."}</p><h2>Home delivery</h2>{store.delivery&&store.areas.length?<><p>Eligibility, minimum order and fees are checked again at checkout.</p><ul>{store.areas.map(a=><li key={a.pincode}>{a.pincode} ? {a.name}: delivery {formatMoney(Number(a.feePaise))}; minimum order {formatMoney(Number(a.minimumPaise))}</li>)}</ul></>:<p>Home delivery is currently unavailable.</p>}</>:<p>Delivery information is currently unavailable.</p>}</section>;}
