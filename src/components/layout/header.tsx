import { CartLink } from "@/components/cart/cart-link";
import Image from "next/image";
import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { SearchForm } from "@/components/ui/search-form";
import { CategoryNavigation } from "./category-navigation";

export function Header() {
  return <header className="site-header">
    <div className="utility-bar"><div className="container utility-content"><span><Icon name="truck" width={16} height={16} /> Home delivery & store pickup</span><Link href="/delivery-areas">View delivery information <Icon name="arrow" width={15} height={15} /></Link></div></div>
    <div className="container header-main">
      <Link href="/" className="brand" aria-label="TRAIT Fish and Meat Hub home"><Image className="brand-logo" src="/trait-logo.jpeg" alt="TRAIT Fish & Meat Hub official logo" width={1254} height={1254} unoptimized preload /><span className="brand-copy"><strong>TRAIT HUB</strong><small>FISH & MEAT</small></span></Link>
      <div className="header-search"><SearchForm id="header-search" /></div>
      <nav aria-label="Customer navigation" className="header-actions"><Link href="/track-order" className="track-link" aria-label="Track Order"><Icon name="orders" /><span>Track Order</span></Link><CartLink /></nav>
    </div>
    <CategoryNavigation />
  </header>;
}
