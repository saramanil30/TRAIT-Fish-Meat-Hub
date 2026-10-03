import type { Metadata } from "next";
import Link from "next/link";
import { storefrontInfo, storeAddress } from "@/lib/storefront-info";
import { formatMoney } from "@/lib/format";
export const metadata:Metadata={title:"Delivery and pickup",description:"Home delivery areas, delivery fees and minimum orders, and store pickup at TRAIT Fish & Meat Hub, Hyderabad."};
export default async function Page(){
 const store=await storefrontInfo();
 if(!store) return <section className="container page-section info-page"><h1>Delivery and pickup</h1><div className="order-panel"><p>Delivery information is unavailable right now. Please try again in a moment.</p></div></section>;
 return <section className="container page-section info-page"><p className="eyebrow">Fresh to your door</p><h1>Delivery and pickup</h1>
  <div className="info-grid">
   <div className="order-panel"><h2>Home delivery</h2>{store.delivery&&store.areas.length?<><p>We deliver to these areas. Your pincode, minimum order and fee are confirmed at checkout.</p>
    <table className="info-table"><thead><tr><th scope="col">Area</th><th scope="col">Delivery fee</th><th scope="col">Minimum order</th></tr></thead><tbody>{store.areas.map(a=><tr key={a.pincode}><td><strong className="info-area">{a.name||a.pincode}</strong>{a.name&&<span>{a.pincode}</span>}</td><td>{formatMoney(Number(a.feePaise))}</td><td>{Number(a.minimumPaise)?formatMoney(Number(a.minimumPaise)):"No minimum"}</td></tr>)}</tbody></table></>:<p>Home delivery is not available right now. Store pickup is still open.</p>}</div>
   <div className="order-panel"><h2>Store pickup</h2>{store.pickup?<><p>Free. Collect your order from <strong>{store.name}</strong>, {storeAddress(store.address)}.</p>{store.pickupInstructions&&<p>{store.pickupInstructions}</p>}</>:<p>Store pickup is not available right now.</p>}<p><Link className="text-link" href="/contact">Store hours and contact</Link></p></div>
  </div></section>;
}
