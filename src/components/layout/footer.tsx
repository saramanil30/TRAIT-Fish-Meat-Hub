import Image from "next/image";
import Link from "next/link";
import type { NavCategory } from "./site-frame";
import { formatPhone } from "@/lib/format";

/** Store details for the footer, prepared on the server (times already formatted). */
export type FooterStore = { name: string; address: string; phone: string | null; whatsapp: string | null; hours: string[]; areas: string[] };

export function Footer({ categories, store }: { categories: NavCategory[]; store: FooterStore | null }) {
  return <footer className="site-footer"><div className="container footer-main">
    <div className="footer-about"><Link className="footer-brand" href="/" aria-label="TRAIT Fish and Meat Hub home"><Image className="footer-logo" src="/trait-logo.jpeg" alt="TRAIT Fish & Meat Hub official logo" width={1254} height={1254} unoptimized /><strong>TRAIT HUB</strong></Link>
      {store ? <address className="footer-contact"><p>{store.address}</p>{store.phone && <p><a href={"tel:+" + store.phone}>Call {formatPhone(store.phone)}</a></p>}{store.whatsapp && <p><a href={"https://wa.me/" + store.whatsapp} target="_blank" rel="noopener noreferrer">WhatsApp {formatPhone(store.whatsapp)}</a></p>}</address> : <p>Fresh fish, chicken and mutton, cleaned and cut your way.</p>}</div>
    <nav aria-label="Shop footer navigation"><h2>Shop</h2><Link href="/search">All fish & meat</Link>{categories.map(c => <Link key={c.slug} href={"/" + c.slug}>{c.name}</Link>)}</nav>
    <nav aria-label="Footer navigation"><h2>Help</h2><Link href="/track-order">Track Order</Link><Link href="/delivery-areas">Delivery & pickup</Link><Link href="/contact">Contact us</Link><Link href="/terms">Terms of service</Link><Link href="/privacy">Privacy policy</Link></nav>
    {store && <div className="footer-hours"><h2>Store hours</h2>{store.hours.map(line => <p key={line}>{line}</p>)}{store.areas.length > 0 && <><h3>We deliver to</h3><p className="footer-areas">{store.areas.join(" · ")}</p></>}</div>}
  </div><div className="container footer-bottom"><span>&copy; {new Date().getFullYear()} {store?.name ?? "TRAIT Fish & Meat Hub"}</span><Link className="footer-staff-link" href="/admin">Admin / Staff Login</Link></div></footer>;
}
