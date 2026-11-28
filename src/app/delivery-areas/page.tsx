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
    <table className="info-table"><thead><tr><th scope="col">Area</th><th scope="col">Delivery fee</th><th scope="col">Minimum order</th></tr></thead><tbody>{store.areas.map(a=><tr key={a.pincode}><td><strong className="info-area">{a.name||a.pincode}</strong>{a.name&&<span>{a.pincode}</span>}</td><td>{a.mode==="RAPIDO"?<>Via Rapido<span>{a.rapidoEstimate||"Paid separately to Rapido"}{a.advanceRequired?" · Advance payment required":""}</span></>:formatMoney(Number(a.feePaise))}</td><td>{Number(a.minimumPaise)?formatMoney(Number(a.minimumPaise)):"No minimum"}</td></tr>)}</tbody></table></>:<p>Home delivery is not available right now. Store pickup is still open.</p>}</div>
   <div className="order-panel"><h2>Store pickup</h2>{store.pickup?<><p>Free. Collect your order from <strong>{store.name}</strong>, {storeAddress(store.address)}.</p>{store.pickupInstructions&&<p>{store.pickupInstructions}</p>}</>:<p>Store pickup is not available right now.</p>}<p><Link className="text-link" href="/contact">Store hours and contact</Link></p></div>
  </div>
  <div className="order-panel policy-body"><h2>Delivery policy</h2>
   <p>We deliver only within the pincodes listed above, in Hyderabad, Telangana. Choose a delivery slot for today or the next two days at checkout, or &ldquo;Deliver now&rdquo; while the store is open. Orders arrive in the chosen slot; we call you if there is any delay.</p>
   <p>The delivery fee and minimum order for your pincode are shown before you place the order. Areas marked &ldquo;Via Rapido&rdquo; are delivered by a Rapido captain: the Rapido charge is not in our total and is paid separately to Rapido, and some of these areas need advance payment (no cash on delivery). Store pickup is free. Please keep your phone reachable; if we cannot reach you at the address, we will call to arrange another time. Fresh products are not left unattended.</p>
   <p>We do not ship outside our delivery area or by courier. Cancellations and refunds follow our <Link className="text-link" href="/refund-policy">Refund &amp; Cancellation policy</Link>.</p>
  </div></section>;
}
