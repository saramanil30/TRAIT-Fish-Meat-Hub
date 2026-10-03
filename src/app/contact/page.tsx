import type { Metadata } from "next";
import { formatPhone } from "@/lib/format";
import { storefrontInfo, storeAddress, hoursLines, phoneDigits, clockTime, WEEK_DAYS } from "@/lib/storefront-info";
export const metadata:Metadata={title:"Contact the store",description:"Call, WhatsApp or visit TRAIT Fish & Meat Hub in Kokapet, Hyderabad. Store address and opening hours."};
const DAY:Record<string,string>={mon:"Monday",tue:"Tuesday",wed:"Wednesday",thu:"Thursday",fri:"Friday",sat:"Saturday",sun:"Sunday"};
export default async function Page(){
 const store=await storefrontInfo();
 if(!store) return <section className="container page-section info-page"><h1>Contact the store</h1><div className="order-panel"><p>Store contact details are unavailable right now. Please try again in a moment.</p></div></section>;
 const address=storeAddress(store.address);
 const phone=store.phone?phoneDigits(store.phone):null, whatsapp=store.whatsapp?phoneDigits(store.whatsapp):phone;
 return <section className="container page-section info-page"><p className="eyebrow">We&rsquo;re here to help</p><h1>Contact the store</h1>
  <div className="info-grid">
   <div className="order-panel"><h2>{store.name}</h2><address className="info-address">{address}</address>
    <div className="info-actions">{phone&&<a className="button primary" href={"tel:+"+phone}>Call {formatPhone(phone)}</a>}{whatsapp&&<a className="button secondary" href={"https://wa.me/"+whatsapp} target="_blank" rel="noopener noreferrer">WhatsApp us</a>}<a className="button secondary" href={"https://www.google.com/maps/search/?api=1&query="+encodeURIComponent(store.name+", "+address)} target="_blank" rel="noopener noreferrer">Get directions</a></div></div>
   <div className="order-panel"><h2>Opening hours</h2><p className="info-lead">{hoursLines(store.hours??{})[0]}</p>
    <dl className="info-hours">{WEEK_DAYS.map(d=><div key={d}><dt>{DAY[d]}</dt><dd>{(store.hours?.[d]??[]).length?store.hours[d].map(s=>clockTime(s.opens)+" – "+clockTime(s.closes)).join(", "):"Closed"}</dd></div>)}</dl><p className="field-help">India time (IST).</p></div>
  </div></section>;
}
