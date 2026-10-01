import { currentOffers } from "@/lib/offers";
import { OfferList } from "@/components/offers/offer-list";
export async function OfferPane() {
 const offers=await currentOffers();
 return offers.length ? <section className="offer-pane" aria-label="Current offers"><div className="container"><OfferList offers={offers}/></div></section> : null;
}
