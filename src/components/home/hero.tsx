import { OfferPane } from "./offer-pane";
import Image from "next/image";
import Link from "next/link";
import { Icon } from "@/components/ui/icon";
export function Hero() {
  return <><OfferPane /><section className="hero" aria-labelledby="hero-title"><div className="container hero-grid">
    <div className="hero-feature"><Image src="/assets/stitch/hero-fish.jpg" alt="Illustrative kingfish steaks with lemon and herbs" width={480} height={400} sizes="(min-width: 1024px) 23vw, 45vw" preload /><div><span>FISH & SEAFOOD</span><h2>Find your favourite catch</h2><p>Whole, cleaned or cut your way</p></div></div>
    <div className="hero-copy"><p className="eyebrow"><span /> Welcome to TRAIT</p><h1 id="hero-title">Fresh Fish &<br />Tender Meat,<br /><em>Prepared Your Way.</em></h1><p className="hero-description">From everyday meals to weekend favourites, discover the right catch and cut for your kitchen.</p><div className="hero-actions"><Link href="#fresh-title" className="button primary">Explore the collection <Icon name="arrow" /></Link></div></div>
    <div className="hero-feature"><Image src="/assets/stitch/hero-mutton.jpg" alt="Illustrative mutton cuts arranged with herbs and spices" width={480} height={400} sizes="(min-width: 1024px) 23vw, 45vw" /><div><span>CHICKEN & MUTTON</span><h2>A cut for every kitchen</h2><p>Make your next meal your own</p></div></div>
  </div></section></>;
}
