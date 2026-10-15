import Image from "next/image";
import Link from "next/link";
import { AddProductButton } from "@/components/product/add-product-button";
import { Icon, type IconName } from "@/components/ui/icon";
import { WhatsAppGlyph } from "@/components/layout/whatsapp-button";
import { Tagline } from "./hero-slider";
import { cardPriceLabel, isRaw, stockLeftText } from "@/lib/pricing";
import { formatMoney, formatPhone } from "@/lib/format";
import { SHOP_WHATSAPP, WHATSAPP_WINDOW, whatsappLink } from "@/lib/whatsapp";
import { specialBadges, type SpecialBadge } from "@/lib/homepage-content";
import type { ShopCategory } from "@/lib/shop-categories";
import type { Product } from "@/types/catalog";

function SectionHeading({ id, title }: { id: string; title: string }) {
  return <div className="home-heading"><h2 id={id}>{title}</h2><Link href="/search" className="home-view-all" aria-label={"View all products"}>View All <Icon name="arrow" width={15} height={15} /></Link></div>;
}

export function ShopByCategory({ categories }: { categories: ShopCategory[] }) {
  if (!categories.length) return null;
  return <section className="home-section" aria-labelledby="shop-category-title"><div className="container">
    <SectionHeading id="shop-category-title" title="Shop by Category" />
    <ul className="category-circles">{categories.map(c => <li key={c.slug}><Link href={"/" + c.slug}><span className="category-circle"><Image src={c.image} alt="" width={240} height={240} sizes="(max-width: 767px) 84px, 124px" /></span><span className="category-circle-name">{c.name}</span></Link></li>)}</ul>
  </div></section>;
}

/** "₹2,250/kg"; with a higher "Was ₹" price (entered per the product's own sale unit) shown struck through before it.
 *  NET weight cards show a per-kg price, so their was-price is compared and shown per pack instead. */
function SpecialPrice({ product, wasPaise }: { product: Product; wasPaise?: number }) {
  const label = cardPriceLabel(product).replace(" / ", "/");
  const unitPrice = product.pricePaise ?? Math.round(product.pricePerKg * 100);
  const perPack = !isRaw(product) && product.pricingBasis === "NET_WEIGHT";
  const now = perPack ? formatMoney(unitPrice) + "/pack" : label;
  const was = wasPaise && wasPaise > unitPrice ? formatMoney(wasPaise) + (perPack ? "/pack" : label.slice(label.indexOf("/"))) : null;
  return <p className="special-price">{was ? <><s aria-label={"Was " + was}>{was}</s> <strong className="is-sale" aria-label={"Now " + now}>{now}</strong></> : <strong>{label}</strong>}</p>;
}

export type SpecialItem = { product: Product; badge?: SpecialBadge; wasPaise?: number };
export function TodaysSpecials({ items }: { items: SpecialItem[] }) {
  if (!items.length) return null;
  return <section className="home-section" aria-labelledby="specials-title"><div className="container">
    <SectionHeading id="specials-title" title="Today's Specials" />
    <ul className="special-grid">{items.map(({ product, badge, wasPaise }) => <li key={product.id} className="special-card">
      <div className="special-image"><Image src={product.image} alt={product.imageAlt} width={480} height={360} sizes="(max-width: 767px) 46vw, (max-width: 1199px) 30vw, 20vw" />{product.available ? badge && <span className="special-badge">{specialBadges[badge]}</span> : <span className="special-badge is-muted">Sold out</span>}</div>
      <div className="special-body"><h3>{product.name}</h3><SpecialPrice product={product} wasPaise={wasPaise} />{product.available && stockLeftText(product) && <p className="special-stock">{stockLeftText(product)}</p>}<AddProductButton product={product} compact /></div>
    </li>)}</ul>
  </div></section>;
}

const whatsappNumber = formatPhone(SHOP_WHATSAPP.replace(/\D/g, ""));
const strip: { icon: IconName | "whatsapp"; title: string; detail: string; href?: string }[] = [
  { icon: "shield", title: "100% Fresh", detail: "& Hygienic" },
  { icon: "truck", title: "Same Day", detail: "Delivery" },
  { icon: "pin", title: "We Serve Kokapet", detail: "& Nearby Areas", href: "/delivery-areas" },
  { icon: "whatsapp", title: "Order via WhatsApp", detail: whatsappNumber, href: whatsappLink(SHOP_WHATSAPP) },
  { icon: "card", title: "Cash / UPI", detail: "on delivery" },
];
export function TrustStrip() {
  return <section className="trust-strip" aria-label="Why shop with TRAIT"><ul className="container">{strip.map(item => {
    const body = <><span className={item.icon === "whatsapp" ? "trust-strip-icon is-whatsapp" : "trust-strip-icon"}>{item.icon === "whatsapp" ? <WhatsAppGlyph width={30} height={30} /> : <Icon name={item.icon} width={30} height={30} />}</span><span className="trust-strip-text"><span>{item.title}</span><span className={item.icon === "whatsapp" ? "is-strong" : undefined}>{item.detail}</span></span></>;
    return <li key={item.title}>{!item.href ? body : item.icon === "whatsapp" ? <a href={item.href} target={WHATSAPP_WINDOW}>{body}</a> : <Link href={item.href}>{body}</Link>}</li>;
  })}</ul></section>;
}

export function HomeBanner({ title, tagline, button }: { title: string; tagline: string; button: string }) {
  return <section className="home-banner" aria-labelledby="home-banner-title"><div className="home-banner-image"><Image src="/assets/stitch/seer-fish.jpg" alt="" fill sizes="(max-width: 767px) 100vw, 45vw" /></div>
    <div className="container home-banner-content">
      <span className="home-banner-mark" aria-hidden="true"><Icon name="fish" width={34} height={34} /></span>
      <div className="home-banner-copy"><h2 id="home-banner-title">{title}</h2><p><Tagline text={tagline} /></p></div>
      <Link href="/search" className="button primary">{button} <Icon name="arrow" width={18} height={18} /></Link>
    </div></section>;
}
