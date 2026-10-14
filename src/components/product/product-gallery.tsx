"use client";
import Image from "next/image";
import { useRef, useState, type KeyboardEvent } from "react";

/** Product popup photos: a swipeable, scroll-snapped strip with thumbnails. One photo shows as before. */
export function ProductGallery({ photos, image, alt }: { photos?: readonly { src: string; alt: string }[]; image: string; alt: string }) {
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  if (!photos || photos.length < 2) return <Image className="selection-photo" src={image} alt={alt} width={448} height={336} />;
  function show(next: number) {
    const element = track.current;
    if (!element) return;
    const target = Math.max(0, Math.min(photos!.length - 1, next));
    element.scrollTo({ left: target * element.clientWidth, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    setIndex(target);
  }
  function keys(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") { event.preventDefault(); show(index + (event.key === "ArrowRight" ? 1 : -1)); }
  }
  return <div className="selection-gallery">
    <div ref={track} className="gallery-track" tabIndex={0} role="group" aria-roledescription="carousel" aria-label={"Product photos, " + (index + 1) + " of " + photos.length + ". Swipe or use the arrow keys."} onKeyDown={keys}
      onScroll={event => { const element = event.currentTarget; if (element.clientWidth) setIndex(Math.round(element.scrollLeft / element.clientWidth)); }}>
      {photos.map((photo, n) => <Image key={photo.src} className="selection-photo" src={photo.src} alt={photo.alt} width={448} height={336} priority={n === 0} sizes="(max-width: 767px) 92vw, 400px" draggable={false} />)}
    </div>
    <div className="gallery-thumbs">{photos.map((photo, n) => <button type="button" key={photo.src} aria-label={"Show photo " + (n + 1) + " of " + photos.length} aria-current={n === index} onClick={() => show(n)}>
      <Image src={photo.src} alt="" width={96} height={96} sizes="56px" />
    </button>)}</div>
  </div>;
}
