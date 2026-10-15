"use client";
import Image from "next/image";
import Link from "next/link";
import { Fragment, useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "@/components/ui/icon";
export type HeroSlide = { badge: string; headline: string; subtitle: string; src: string; alt: string };
const trustIcons: IconName[] = ["leaf", "drop", "medal", "clock"];
const AUTOPLAY_MS = 6000;
/** "Quality is Our TRAIT." with every "TRAIT" in red. */
export function Tagline({ text }: { text: string }) {
  return <>{text.split(/(TRAIT)/).map((part, n) => part === "TRAIT" ? <b key={n}>TRAIT</b> : <Fragment key={n}>{part}</Fragment>)}</>;
}
/** Three fading slides with arrows, dots and swipe. Auto-advances unless paused (hover, focus, hidden tab) or the visitor prefers reduced motion. */
export function HeroSlider({ slides, tagline, button, trust, preview }: { slides: HeroSlide[]; tagline: string; button: string; trust: string[]; preview: boolean }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const touch = useRef<number | null>(null);
  const go = (n: number) => setIndex((n + slides.length) % slides.length);
  useEffect(() => {
    if (preview || paused || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => { if (!document.hidden) setIndex(i => (i + 1) % slides.length); }, AUTOPLAY_MS);
    return () => window.clearInterval(timer);
  }, [preview, paused, slides.length]);
  return <div className="hero-slider" role="group" aria-roledescription="carousel" aria-label="Featured" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
    onFocus={() => setPaused(true)} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setPaused(false); }}
    onTouchStart={e => { touch.current = e.touches[0].clientX; }} onTouchEnd={e => { const start = touch.current; touch.current = null; if (start === null) return; const dx = e.changedTouches[0].clientX - start; if (Math.abs(dx) > 40) go(index + (dx < 0 ? 1 : -1)); }}>
    <div className="hero-slides">{slides.map((s, n) => {
      const active = n === index, Heading = n === 0 && !preview ? "h1" : "p";
      return <div key={n} className={active ? "hero-slide is-active" : "hero-slide"} role="group" aria-roledescription="slide" aria-label={(n + 1) + " of " + slides.length} aria-hidden={!active} inert={!active}>
        <div className="hero-image"><Image src={s.src} alt={s.alt} fill sizes="(max-width: 767px) 100vw, 62vw" preload={n === 0 && !preview} /></div>
        <div className="container hero-content">
          <p className="hero-badge">{s.badge}</p>
          <Heading id={n === 0 && !preview ? "hero-title" : undefined} className="hero-title">{s.headline}</Heading>
          <p className="hero-second">{s.subtitle}</p>
          <p className="hero-tagline"><Tagline text={tagline} /></p>
          <ul className="hero-trust">{trust.map((label, i) => <li key={i}><Icon name={trustIcons[i]} width={24} height={24} /><span>{label}</span></li>)}</ul>
          {preview ? <span className="button primary hero-cta">{button} <Icon name="arrow" width={18} height={18} /></span> : <Link href="/search" className="button primary hero-cta">{button} <Icon name="arrow" width={18} height={18} /></Link>}
        </div>
      </div>;
    })}</div>
    {!preview && <>
      <button type="button" className="hero-arrow is-prev" onClick={() => go(index - 1)} aria-label="Previous slide"><Icon name="chevronLeft" width={30} height={30} /></button>
      <button type="button" className="hero-arrow is-next" onClick={() => go(index + 1)} aria-label="Next slide"><Icon name="chevronRight" width={30} height={30} /></button>
      <div className="hero-dots">{slides.map((_, n) => <button key={n} type="button" aria-label={"Show slide " + (n + 1)} aria-current={n === index ? "true" : undefined} onClick={() => go(n)} />)}</div>
    </>}
  </div>;
}
