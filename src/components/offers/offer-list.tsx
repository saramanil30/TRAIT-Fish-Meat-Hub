import type { CurrentOffer } from "@/lib/offers";
import { formatMoney } from "@/lib/format";
export function OfferList({offers}:{offers:CurrentOffer[]}) {
 return <><ul className="offer-list">{offers.map(o=><li key={o.id}><strong>{o.title} · {o.kind==="PERCENT" ? `${o.value/100}% off` : `${formatMoney(o.value)} off`}</strong>{o.message&&<p>{o.message}</p>}<p>{o.scope==="STORE" ? "Whole store" : o.targetNames?.join(", ")} · Ends <time dateTime={o.endsAt}>{new Date(o.endsAt).toLocaleString("en-IN",{timeZone:"Asia/Kolkata",dateStyle:"medium",timeStyle:"short"})} IST</time></p></li>)}</ul><p className="field-help">The best eligible offer applies automatically at checkout. Offers do not stack. Delivery charges are excluded; minimum merchandise payable is ₹0.01.</p></>;
}
