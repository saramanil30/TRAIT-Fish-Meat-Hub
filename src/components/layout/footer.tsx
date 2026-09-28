import Image from "next/image";
import Link from "next/link";
export function Footer() {
  return <footer className="site-footer"><div className="container footer-main">
    <div className="footer-about"><Link className="footer-brand" href="/" aria-label="TRAIT Fish and Meat Hub home"><Image className="footer-logo" src="/trait-logo.jpeg" alt="TRAIT Fish & Meat Hub official logo" width={1254} height={1254} unoptimized /><strong>TRAIT HUB</strong></Link><p>Fresh choices. Familiar flavours. Fish and meat, prepared your way for your next home-cooked meal.</p></div>
    <nav aria-label="Shop footer navigation"><h2>Explore the collection</h2><Link href="/search">All fish & meat</Link><Link href="/fish">Fish & seafood</Link><Link href="/chicken">Chicken</Link><Link href="/mutton">Mutton</Link></nav>
    <nav aria-label="Footer navigation"><h2>Customer care</h2><Link href="/contact">Contact</Link><Link href="/delivery-areas">Delivery Areas</Link><Link href="/track-order">Track Order</Link></nav>
    <div className="footer-preview"><h2>Prepared your way</h2><p>Choose a preparation and raw weight, then review every detail before checkout.</p><span className="footer-label">FRESH, YOUR WAY</span><p>Availability and final prices are confirmed at checkout.</p></div>
  </div><div className="container footer-bottom"><span>&copy; {new Date().getFullYear()} TRAIT Fish & Meat Hub</span><div><Link href="/terms">Terms</Link><Link href="/privacy">Privacy</Link></div><Link className="footer-staff-link" href="/admin">Admin / Staff Login</Link></div></footer>;
}
