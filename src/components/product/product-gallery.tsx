"use client";
import Image from "next/image";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

type Photo = { src: string; alt: string };
const smooth = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" as const : "smooth" as const;

/** Product popup photos: the whole photo (never cropped) on a neutral background, swipeable when there are several,
 *  thumbnails below. Tapping the photo opens a full-screen, swipeable view; tapping a photo there zooms it to 2×. */
export function ProductGallery({ photos, image, alt }: { photos?: readonly Photo[]; image: string; alt: string }) {
  const list: readonly Photo[] = photos?.length ? photos : [{ src: image, alt }];
  const many = list.length > 1;
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [viewing, setViewing] = useState(false);
  function show(next: number, behavior: ScrollBehavior = smooth()) {
    const element = track.current;
    const target = Math.max(0, Math.min(list.length - 1, next));
    element?.scrollTo({ left: target * element.clientWidth, behavior });
    setIndex(target);
  }
  function keys(event: KeyboardEvent<HTMLDivElement>) {
    if (many && (event.key === "ArrowRight" || event.key === "ArrowLeft")) { event.preventDefault(); show(index + (event.key === "ArrowRight" ? 1 : -1)); }
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setViewing(true); }
  }
  return <div className="selection-gallery">
    <div className="gallery-stage">
    <div ref={track} className="gallery-track" tabIndex={0} role="group" aria-roledescription={many ? "carousel" : undefined}
      aria-label={many ? "Product photos, " + (index + 1) + " of " + list.length + ". Swipe or use the arrow keys. Press Enter for full screen." : "Product photo. Press Enter for full screen."}
      onKeyDown={keys} onScroll={event => { const element = event.currentTarget; if (element.clientWidth) setIndex(Math.round(element.scrollLeft / element.clientWidth)); }}>
      {list.map((photo, n) => <button type="button" tabIndex={-1} key={n + ":" + photo.src} className="gallery-slide" aria-label={"View photo " + (n + 1) + " full screen"} onClick={() => { setIndex(n); setViewing(true); }}>
        <Image className="selection-photo" src={photo.src} alt={photo.alt} width={800} height={600} priority={n === 0} sizes="(max-width: 767px) 100vw, 440px" draggable={false} />
      </button>)}
    </div>
    <span className="gallery-expand" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 16 16"><path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
    </div>
    {many && <div className="gallery-thumbs">{list.map((photo, n) => <button type="button" key={n + ":" + photo.src} aria-label={"Show photo " + (n + 1) + " of " + list.length} aria-current={n === index} onClick={() => show(n)}>
      <Image src={photo.src} alt="" width={96} height={96} sizes="56px" />
    </button>)}</div>}
    {viewing && <PhotoViewer photos={list} start={index} onClose={at => { setViewing(false); show(at, "auto"); track.current?.focus(); }} />}
  </div>;
}

/** Full-screen photo view, a modal <dialog> above the options popup. Swipe or arrow keys move between photos;
 *  a tap toggles 2× zoom (then drag/scroll to pan; pinch zoom also works on touch). Escape or × closes. */
function PhotoViewer({ photos, start, onClose }: { photos: readonly Photo[]; start: number; onClose: (index: number) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(start);
  const [zoomed, setZoomed] = useState(false);
  const many = photos.length > 1;
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (!element.open) element.showModal();
    element.querySelector<HTMLElement>(".photo-viewer-close")?.focus();
    track.current?.scrollTo({ left: start * track.current.clientWidth });
    return () => { if (element.open) element.close(); };
  }, [start]);
  function show(next: number) {
    const element = track.current;
    const target = Math.max(0, Math.min(photos.length - 1, next));
    setZoomed(false);
    element?.scrollTo({ left: target * element.clientWidth, behavior: smooth() });
    setIndex(target);
  }
  function keys(event: KeyboardEvent<HTMLDialogElement>) {
    // Keep keys away from the options popup behind (its Tab trap and Escape handling).
    event.stopPropagation();
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") { event.preventDefault(); show(index + (event.key === "ArrowRight" ? 1 : -1)); }
    if (event.key === "Tab") {
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not([disabled])"));
      const at = controls.indexOf(document.activeElement as HTMLButtonElement);
      event.preventDefault();
      controls[(at + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]?.focus();
    }
  }
  return <dialog ref={dialog} className="photo-viewer" aria-label={"Photo " + (index + 1) + " of " + photos.length} onKeyDown={keys}
    onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose(index); }}>
    <div ref={track} className={"photo-viewer-track" + (zoomed ? " is-zoomed" : "")}
      onScroll={event => { const element = event.currentTarget; if (!zoomed && element.clientWidth) setIndex(Math.round(element.scrollLeft / element.clientWidth)); }}>
      {photos.map((photo, n) => <div key={n + ":" + photo.src} className={"photo-viewer-slide" + (zoomed && n === index ? " is-zoomed" : "")}
        onClick={event => {
          const slide = event.currentTarget;
          const box = slide.getBoundingClientRect();
          const x = (event.clientX - box.left) / box.width, y = (event.clientY - box.top) / box.height;
          // Zoom in on the tapped point; a second tap zooms back out.
          if (!zoomed) requestAnimationFrame(() => slide.scrollTo({ left: x * slide.scrollWidth - box.width / 2, top: y * slide.scrollHeight - box.height / 2 }));
          setZoomed(!zoomed);
        }}>
        <Image src={photo.src} alt={photo.alt} width={1600} height={1200} sizes={zoomed && n === index ? "200vw" : "100vw"} quality={90} draggable={false} />
      </div>)}
    </div>
    <div className="photo-viewer-bar">
      {many && <span aria-live="polite">{index + 1} / {photos.length}</span>}
      <button type="button" autoFocus className="photo-viewer-close" aria-label="Close full-screen photo" onClick={() => onClose(index)}><svg aria-hidden="true" width="18" height="18" viewBox="0 0 16 16"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" /></svg></button>
    </div>
    {many && <>
      <button type="button" className="photo-viewer-nav is-prev" aria-label="Previous photo" disabled={index === 0} onClick={() => show(index - 1)}>‹</button>
      <button type="button" className="photo-viewer-nav is-next" aria-label="Next photo" disabled={index === photos.length - 1} onClick={() => show(index + 1)}>›</button>
    </>}
  </dialog>;
}
