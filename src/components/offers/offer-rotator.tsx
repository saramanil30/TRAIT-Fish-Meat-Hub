"use client";
import { Children, useEffect, useState, useSyncExternalStore } from "react";

/* One clock for every rotator on the page, so the header strip and the homepage band show the same offer at the same
   time. It advances every 5 seconds; hovering, touching or focusing any rotator holds all of them, and a dot moves all. */
type Position = { index: number; previous: number | null };
const listeners = new Set<() => void>();
let position: Position = { index: 0, previous: null };
let count = 0, holds = 0, timer: ReturnType<typeof setTimeout> | undefined;
const resting: Position = { index: 0, previous: null };
function schedule() {
  clearTimeout(timer);
  if (count > 1 && holds === 0 && listeners.size) timer = setTimeout(() => go((position.index + 1) % count), 5000);
}
function go(next: number) {
  if (next !== position.index) { position = { index: next, previous: position.index }; listeners.forEach(listener => listener()); }
  schedule();
}
function subscribe(listener: () => void) {
  listeners.add(listener); schedule();
  return () => { listeners.delete(listener); schedule(); };
}

/** Shows one offer at a time, sliding right to left every 5 seconds (a fade with reduced motion).
 *  Pauses while hovered, touched or focused; dots jump to an offer. One slide renders static. */
export function OfferRotator({ children, className, label = "Current offers" }: { children: React.ReactNode; className?: string; label?: string }) {
  const slides = Children.toArray(children);
  const total = slides.length;
  const { index, previous } = useSyncExternalStore(subscribe, () => position, () => resting);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = hovered || focused;
  const current = index < total ? index : 0;

  useEffect(() => { count = total; schedule(); }, [total]);
  useEffect(() => {
    if (!paused) return;
    holds++; schedule();
    return () => { holds--; schedule(); };
  }, [paused]);

  if (total < 2) return <div className={className}>{slides}</div>;
  return <div className={(className ? className + " " : "") + "offer-rotator"} role="region" aria-roledescription="carousel" aria-label={label}
    onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}
    onFocus={() => setFocused(true)} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false); }}>
    <div className="offer-rotator-viewport" aria-live={paused ? "polite" : "off"}>
      {slides.map((slide, i) => <div key={i} className={"offer-rotator-slide" + (i === current ? " is-active" : "") + (i === previous && i !== current ? " is-leaving" : "") + (previous !== null ? " is-moving" : "")}
        role="group" aria-roledescription="slide" aria-label={`${i + 1} of ${total}`} aria-hidden={i !== current} inert={i !== current}>{slide}</div>)}
    </div>
    <div className="offer-rotator-dots">
      {slides.map((_, i) => <button key={i} type="button" aria-label={`Show offer ${i + 1} of ${total}`} aria-current={i === current ? "true" : undefined} onClick={() => go(i)}><span /></button>)}
    </div>
  </div>;
}
