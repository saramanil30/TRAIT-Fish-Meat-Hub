import { OfferPane } from "./offer-pane";
import { HeroBody } from "./hero-body";
import { heroSlides, homepageText } from "@/lib/homepage-text-server";
import { heroImageUrl } from "@/lib/hero-image";
export async function Hero() {
  const [saved, slides] = await Promise.all([homepageText(), heroSlides()]);
  const photos = slides.map(s => ({ src: heroImageUrl(process.env.SUPABASE_URL, s.path), alt: s.alt || "TRAIT Fish & Meat Hub" }));
  return <><OfferPane /><section className="hero" aria-labelledby="hero-title"><HeroBody saved={saved} photos={photos} /></section></>;
}
