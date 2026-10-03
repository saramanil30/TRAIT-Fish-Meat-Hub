import type { CurrentOffer } from "@/lib/offers";
import { formatMoney } from "@/lib/format";
/** The title, plus the amount only when the title does not already say it. */
function offerHeadline(o:CurrentOffer){const amount=o.kind==="PERCENT"?`${o.value/100}% off`:`${formatMoney(o.value)} off`;return o.title.toLowerCase().includes(amount.toLowerCase())?o.title:o.title+" · "+amount;}
export function OfferList({offers}:{offers:CurrentOffer[]}) {
 return <><ul className="offer-list">{offers.map(o=><li key={o.id}><strong>{offerHeadline(o)}</strong>{o.code&&<p className="offer-code-line">Use code <span className="offer-code">{o.code}</span></p>}{o.message&&<p className="offer-message">{o.message}</p>}<p>{o.scope==="STORE" ? "Whole store" : o.targetNames?.join(", ")} · Ends <time dateTime={o.endsAt}>{new Date(o.endsAt).toLocaleString("en-IN",{timeZone:"Asia/Kolkata",dateStyle:"medium",timeStyle:"short"})} IST</time></p></li>)}</ul><p className="field-help">Apply a coupon code in your cart or at checkout. One coupon per order. Delivery charges are excluded.</p></>;
}
