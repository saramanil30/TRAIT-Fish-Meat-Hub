import Image from "next/image";
import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { resolveHomepageText, type HomepageText } from "@/lib/homepage-text";
/** The hero's three columns. Also rendered by the admin "Homepage text" live preview, where the button is inert. */
export function HeroBody({ saved, preview = false }: { saved: HomepageText; preview?: boolean }) {
  const t = resolveHomepageText(saved);
  const Heading = preview ? "p" : "h1";
  return <div className="container hero-grid">
    <div className="hero-feature"><Image src="/assets/stitch/hero-fish.jpg" alt="Illustrative kingfish steaks with lemon and herbs" width={480} height={400} sizes="(min-width: 1024px) 23vw, 45vw" preload={!preview} /><div><span>{t.leftLabel}</span><h2>{t.leftTitle}</h2><p>{t.leftSubtitle}</p></div></div>
    <div className="hero-copy"><p className="eyebrow"><span /> {t.badge}</p><Heading id={preview ? undefined : "hero-title"} className="hero-title">{t.customHeadline ? t.headline : <>Fresh Fish &amp;<br />Tender Meat,</>}<br /><em>{t.highlight}</em></Heading><p className="hero-description">{t.subtitle}</p><div className="hero-actions">{preview ? <span className="button primary">{t.button} <Icon name="arrow" /></span> : <Link href="#fresh-title" className="button primary">{t.button} <Icon name="arrow" /></Link>}</div></div>
    <div className="hero-feature"><Image src="/assets/stitch/hero-mutton.jpg" alt="Illustrative mutton cuts arranged with herbs and spices" width={480} height={400} sizes="(min-width: 1024px) 23vw, 45vw" /><div><span>{t.rightLabel}</span><h2>{t.rightTitle}</h2><p>{t.rightSubtitle}</p></div></div>
  </div>;
}
