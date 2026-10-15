import { HeroSlider, type HeroSlide } from "./hero-slider";
import { resolveHomepageText, type HomepageText } from "@/lib/homepage-text";
const images = [
  { src: "/assets/stitch/hero-fish.jpg", alt: "Illustrative fresh fish steaks on ice with lemon and herbs" },
  { src: "/assets/stitch/prawns.jpg", alt: "Illustrative platter of fresh prawns on ice" },
  { src: "/assets/stitch/hero-mutton.jpg", alt: "Illustrative mutton cuts arranged with herbs and spices" },
];
/** The hero slider, with every text from Settings → Homepage text. Also rendered by the admin live preview, where it stays on slide 1 and the button is inert. */
export function HeroBody({ saved, preview = false }: { saved: HomepageText; preview?: boolean }) {
  const t = resolveHomepageText(saved);
  const slides: HeroSlide[] = [
    { badge: t.badge, headline: t.headline, subtitle: t.subtitle, ...images[0] },
    { badge: t.leftLabel, headline: t.leftTitle, subtitle: t.leftSubtitle, ...images[1] },
    { badge: t.rightLabel, headline: t.rightTitle, subtitle: t.rightSubtitle, ...images[2] },
  ];
  return <HeroSlider slides={slides} tagline={t.highlight} button={t.button} trust={[t.trust1, t.trust2, t.trust3, t.trust4]} preview={preview} />;
}
