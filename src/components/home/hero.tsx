import { OfferPane } from "./offer-pane";
import { HeroBody } from "./hero-body";
import { homepageText } from "@/lib/homepage-text-server";
export async function Hero() {
  return <><OfferPane /><section className="hero" aria-labelledby="hero-title"><HeroBody saved={await homepageText()} /></section></>;
}
