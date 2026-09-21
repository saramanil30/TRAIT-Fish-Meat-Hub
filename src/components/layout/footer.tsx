import Image from "next/image";
import Link from "next/link";

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="container footer-main">
        <div>
          <Link className="footer-brand" href="/" aria-label="TRAIT Fish and Meat Hub home">
            <Image className="footer-logo" src="/trait-logo.jpeg" alt="TRAIT Fish & Meat Hub official logo" width={1254} height={1254} unoptimized />
          </Link>
          <p className="footer-tagline">Fresh choices. Familiar flavours.</p>
        </div>
        <nav aria-label="Footer navigation">
          <Link href="/contact">Contact</Link>
          <Link href="/delivery-areas">Delivery Areas</Link>
          <Link href="/track-order">Track Order</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
        </nav>
      </div>
      <div className="container footer-bottom">
        <span>&copy; {new Date().getFullYear()} TRAIT Fish & Meat Hub</span>
        <span>Storefront preview &middot; Ordering coming soon</span>
      </div>
    </footer>
  );
}
