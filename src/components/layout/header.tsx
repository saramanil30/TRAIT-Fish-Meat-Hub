import Image from "next/image";
import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { SearchForm } from "@/components/ui/search-form";
import { categories } from "@/data/catalog";

export function Header() {
  return (
    <header className="site-header">
      <div className="container header-main">
        <Link href="/" className="brand" aria-label="TRAIT Fish and Meat Hub home">
          <Image className="brand-logo" src="/trait-logo.jpeg" alt="TRAIT Fish & Meat Hub official logo" width={1254} height={1254} unoptimized preload />
        </Link>
        <div className="header-search"><SearchForm id="header-search" /></div>
        <nav aria-label="Customer navigation" className="header-actions">
          <Link href="/track-order" className="track-link" aria-label="Track Order"><Icon name="orders" /><span>Track Order</span></Link>
          <Link href="/cart" aria-label="Cart, 0 items" className="cart-link"><Icon name="bag" /><span>Cart</span><span className="count">0</span></Link>
        </nav>
      </div>
      <nav className="category-nav container" aria-label="Shop categories">
        <Link href="/search">Browse all</Link>
        {categories.map(category => <Link key={category.slug} href={"/" + category.slug}>{category.name}</Link>)}
        <span>Good food starts with good ingredients.</span>
      </nav>
    </header>
  );
}
