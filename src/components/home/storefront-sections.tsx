import Image from "next/image";
import Link from "next/link";
import { ProductCard } from "@/components/product/product-card";
import { Icon, type IconName } from "@/components/ui/icon";
import { WhatsAppGlyph } from "@/components/layout/whatsapp-button";
import { Tagline } from "./hero-slider";
import { formatPhone } from "@/lib/format";
import { SHOP_WHATSAPP, WHATSAPP_WINDOW, whatsappLink } from "@/lib/whatsapp";
import type { SpecialBadge } from "@/lib/homepage-content";
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

export type SpecialItem = { product: Product; badge?: SpecialBadge; wasPaise?: number };
export function TodaysSpecials({ items }: { items: SpecialItem[] }) {
  if (!items.length) return null;
  return <section className="home-section" aria-labelledby="specials-title"><div className="container">
    <SectionHeading id="specials-title" title="Today's Specials" />
    <ul className="special-grid">{items.map(({ product, badge, wasPaise }) => <li key={product.id}><ProductCard product={product} badge={badge} wasPaise={wasPaise} /></li>)}</ul>
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
