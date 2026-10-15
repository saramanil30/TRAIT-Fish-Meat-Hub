import { CartLink } from "@/components/cart/cart-link";
import Image from "next/image";
import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { SearchForm } from "@/components/ui/search-form";
import { CategoryNavigation } from "./category-navigation";
import { OfferRotator } from "@/components/offers/offer-rotator";
import { WhatsAppGlyph } from "./whatsapp-button";
import { SHOP_WHATSAPP, WHATSAPP_WINDOW, whatsappLink } from "@/lib/whatsapp";
import { formatPhone } from "@/lib/format";
import type { NavCategory, SocialLinks, StripOffer } from "./site-frame";

export function Header({ categories, offers, social, scrolls, showCategories = true }: { categories: NavCategory[]; offers: StripOffer[]; social: SocialLinks; scrolls: boolean; showCategories?: boolean }) {
  // Desktop: the whole block sticks. Mobile: the wrapper drops out of layout, so only the <header> row sticks.
  // Cart and checkout (`scrolls`): nothing sticks; the whole header scrolls away with the page.
  return <div className={scrolls ? "site-top is-static" : "site-top"}>
    <div className="utility-bar"><div className="container utility-content">
      <p className="utility-tagline">Fresh Seafood <span aria-hidden="true">|</span> Quality Meat <span aria-hidden="true">|</span> Home Delivery</p>
      <nav className="utility-links" aria-label="Contact and order tracking">
        {social.instagram && <a href={social.instagram} target="_blank" rel="noopener noreferrer" aria-label="TRAIT on Instagram (opens in a new tab)"><Icon name="instagram" width={18} height={18} /></a>}
        {social.facebook && <a href={social.facebook} target="_blank" rel="noopener noreferrer" aria-label="TRAIT on Facebook (opens in a new tab)"><Icon name="facebook" width={18} height={18} /></a>}
        <a className="utility-whatsapp" href={whatsappLink(SHOP_WHATSAPP)} target={WHATSAPP_WINDOW} aria-label={"WhatsApp " + formatPhone(SHOP_WHATSAPP.replace(/\D/g, ""))}><WhatsAppGlyph /><span>{formatPhone(SHOP_WHATSAPP.replace(/\D/g, ""))}</span></a>
        <Link className="utility-track" href="/track-order"><Icon name="box" width={17} height={17} /><span>Track Order</span></Link>
      </nav>
    </div></div>
    <header className="site-header"><div className="container header-main">
      <Link href="/" className="brand" aria-label="TRAIT Fish and Meat Hub home"><Image className="brand-logo" src="/trait-logo.jpeg" alt="TRAIT Fish & Meat Hub official logo" width={1254} height={1254} unoptimized preload /><span className="brand-copy"><strong>TRAIT</strong><small>FISH &amp; MEAT HUB</small><em>Quality is Our <b>TRAIT.</b></em></span></Link>
      <div className="header-search"><SearchForm id="header-search" /></div>
      <nav aria-label="Customer navigation" className="header-actions"><CartLink /></nav>
    </div><div className="collection-strip" role="region" aria-label="The TRAIT collection"><div className="container"><strong>The TRAIT collection</strong>{offers.length ? <OfferRotator className="strip-offers" label="Current offers">{offers.map(o => <span key={o.id} className="strip-offer"><span className="strip-offer-text">{o.text}<span className="strip-offer-ends"> · {o.ends}</span></span>{o.code && <span className="strip-code">Code <b>{o.code}</b></span>}</span>)}</OfferRotator> : <span>Fresh fish, chicken & mutton · Cleaned and cut your way</span>}</div></div></header>
    {showCategories && <div className="category-bar"><CategoryNavigation categories={categories} /></div>}
  </div>;
}
