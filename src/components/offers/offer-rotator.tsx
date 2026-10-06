"use client";
import { Children, useEffect, useState } from "react";

/** Shows one offer at a time, sliding right to left every 5 seconds (a fade with reduced motion).
 *  Pauses while hovered, touched or focused; dots jump to an offer. One slide renders static. */
export function OfferRotator({ children, className, label = "Current offers" }: { children: React.ReactNode; className?: string; label?: string }) {
  const slides = Children.toArray(children);
  const [active, setActive] = useState(0);
  const [leaving, setLeaving] = useState<number | null>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = hovered || focused;
  const count = slides.length;
  const current = active < count ? active : 0;

  function show(next: number) {
    if (next === current) return;
    setLeaving(current);
    setActive(next);
  }

  useEffect(() => {
    if (count < 2 || paused) return;
    const timer = setTimeout(() => { setLeaving(current); setActive((current + 1) % count); }, 5000);
    return () => clearTimeout(timer);
  }, [count, current, paused]);

  if (count < 2) return <div className={className}>{slides}</div>;
  return <div className={(className ? className + " " : "") + "offer-rotator"} role="region" aria-roledescription="carousel" aria-label={label}
    onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}
    onFocus={() => setFocused(true)} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false); }}>
    <div className="offer-rotator-viewport" aria-live={paused ? "polite" : "off"}>
      {slides.map((slide, i) => <div key={i} className={"offer-rotator-slide" + (i === current ? " is-active" : "") + (i === leaving && i !== current ? " is-leaving" : "") + (leaving !== null ? " is-moving" : "")}
        role="group" aria-roledescription="slide" aria-label={`${i + 1} of ${count}`} aria-hidden={i !== current} inert={i !== current}>{slide}</div>)}
    </div>
    <div className="offer-rotator-dots">
      {slides.map((_, i) => <button key={i} type="button" aria-label={`Show offer ${i + 1} of ${count}`} aria-current={i === current ? "true" : undefined} onClick={() => show(i)}><span /></button>)}
    </div>
  </div>;
}
