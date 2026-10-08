import { offerScope, offerTerms, type CurrentOffer } from "@/lib/offers";
import { formatDateTimeIST, formatMoney } from "@/lib/format";
import { OfferRotator } from "./offer-rotator";
/** The title, plus the amount only when the title does not already say it. */
function offerHeadline(o:CurrentOffer){const amount=o.kind==="PERCENT"?`${o.value/100}% off`:`${formatMoney(o.value)} off`;return o.title.toLowerCase().includes(amount.toLowerCase())?o.title:o.title+" · "+amount;}
/** One slide per offer: banner image left (above on phones) and the details right; without an image the text is centred. */
export function OfferList({offers}:{offers:CurrentOffer[]}) {
 return <><OfferRotator className="offer-list">{offers.map(o=>{const terms=offerTerms(o);return <div key={o.id} className={"offer-item"+(o.imageUrl?" has-image":"")}>
  {/* eslint-disable-next-line @next/next/no-img-element -- public Storage URL, sized by CSS */}
  {o.imageUrl&&<img className="offer-image" src={o.imageUrl} alt="" loading="lazy" decoding="async"/>}
  <div className="offer-text"><strong>{offerHeadline(o)}</strong>{o.code&&<p className="offer-code-line">Use code <span className="offer-code">{o.code}</span></p>}{o.message&&<p className="offer-message">{o.message}</p>}
  <p className="offer-scope">{offerScope(o)}{terms&&<> · {terms}</>}</p><p className="offer-ends">Ends <time dateTime={o.endsAt}>{formatDateTimeIST(o.endsAt)} IST</time></p></div></div>;})}</OfferRotator><p className="field-help">Apply a coupon code in your cart or at checkout. One coupon per order. Delivery charges are excluded.</p></>;
}
