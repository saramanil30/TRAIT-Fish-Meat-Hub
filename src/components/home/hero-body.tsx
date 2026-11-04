import { HeroSlider, type HeroSlide } from "./hero-slider";
import { resolveHomepageText, type HomepageText } from "@/lib/homepage-text";
const images = [
  { src: "/assets/stitch/hero-fish.jpg", alt: "Illustrative fresh fish steaks on ice with lemon and herbs" },
  { src: "/assets/stitch/prawns.jpg", alt: "Illustrative platter of fresh prawns on ice" },
  { src: "/assets/stitch/hero-mutton.jpg", alt: "Illustrative mutton cuts arranged with herbs and spices" },
];
/** The hero slider, with every text from Settings → Homepage text. Photos come from Settings → Homepage banner (up to 5,
 *  in order; slide n shows the n-th of the three hero texts, repeating); without any, the three built-in photos show.
 *  Also rendered by the admin live preview, where it stays on slide 1 and the button is inert. */
export function HeroBody({ saved, preview = false, photos = [] }: { saved: HomepageText; preview?: boolean; photos?: { src: string; alt: string }[] }) {
  const t = resolveHomepageText(saved);
  const texts = [
    { badge: t.badge, headline: t.headline, subtitle: t.subtitle },
    { badge: t.leftLabel, headline: t.leftTitle, subtitle: t.leftSubtitle },
    { badge: t.rightLabel, headline: t.rightTitle, subtitle: t.rightSubtitle },
  ];
  const slides: HeroSlide[] = (photos.length ? photos : images).map((image, n) => ({ ...texts[n % texts.length], ...image }));
  return <HeroSlider slides={slides} tagline={t.highlight} button={t.button} trust={[t.trust1, t.trust2, t.trust3, t.trust4]} preview={preview} />;
}
