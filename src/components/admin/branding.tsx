"use client";
import { startTransition, useActionState, useEffect, useState } from "react";
import { saveStoreBranding, type HomepageTextState } from "@/app/admin/homepage-actions";
import { brandLogoLimitBytes, desktopLogoBounds, mobileLogoBounds } from "@/lib/brand-image";
type Part = "desktop" | "mobile";
const canvasOf = (width: number, height: number) => { const c = document.createElement("canvas"); c.width = width; c.height = height; return c; };
const blobOf = (canvas: HTMLCanvasElement, type: string, quality?: number) => new Promise<Blob | null>(r => canvas.toBlob(r, type, quality));
/** WebP keeps transparency and is smaller; browsers that can't write WebP (older Safari) return PNG, which is kept as PNG. */
async function encodeLogo(canvas: HTMLCanvasElement, name: string) {
 for (const quality of [0.92, 0.85, 0.75]) {
  const webp = await blobOf(canvas, "image/webp", quality);
  if (webp?.type === "image/webp" && webp.size <= brandLogoLimitBytes) return new File([webp], name + ".webp", { type: "image/webp" });
 }
 const png = await blobOf(canvas, "image/png");
 if (png && png.size <= brandLogoLimitBytes) return new File([png], name + ".png", { type: "image/png" });
 throw new Error("This logo is too detailed to save under 512 KB. Try a simpler or smaller file.");
}
const fileType = (file: File) => file.type === "image/png" || file.type === "image/webp";
/** Wide logo: a PNG/WebP that already fits is sent unchanged; larger ones are scaled down to at most 1600×400. */
async function prepareDesktop(file: File) {
 if (!fileType(file)) throw new Error("Choose a PNG or WebP logo (transparent background works best).");
 const bitmap = await createImageBitmap(file).catch(() => null);
 if (!bitmap) throw new Error("This logo could not be read.");
 try {
  if (bitmap.width * 2 < bitmap.height * 3) throw new Error("Use a wide logo: at least 1.5× as wide as it is tall. Upload square icons under Mobile logo.");
  if (bitmap.height < desktopLogoBounds.minHeight) throw new Error("The logo must be at least " + desktopLogoBounds.minHeight + " pixels tall.");
  const fits = file.size <= brandLogoLimitBytes && bitmap.height <= desktopLogoBounds.maxHeight && bitmap.width <= desktopLogoBounds.maxWidth;
  if (fits) return file;
  const scale = Math.min(1600 / bitmap.width, 400 / bitmap.height, 1);
  const canvas = canvasOf(Math.round(bitmap.width * scale), Math.max(desktopLogoBounds.minHeight, Math.round(bitmap.height * scale)));
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return encodeLogo(canvas, "logo-desktop");
 } finally { bitmap.close(); }
}
/** Square icon: fitted (not cropped) into a 512×512 transparent square, plus the 32×32 favicon and the 180×180
 *  home-screen icon as PNG. The home-screen icon gets a white background, since phones show transparency as black. */
async function prepareMobile(file: File) {
 if (!fileType(file)) throw new Error("Choose a PNG or WebP icon (transparent background works best).");
 const bitmap = await createImageBitmap(file).catch(() => null);
 if (!bitmap) throw new Error("This logo could not be read.");
 try {
  if (Math.max(bitmap.width, bitmap.height) < mobileLogoBounds.min) throw new Error("The icon must be at least " + mobileLogoBounds.min + " pixels on its longer side.");
  const draw = (side: number, background?: string) => {
   const canvas = canvasOf(side, side), g = canvas.getContext("2d")!;
   if (background) { g.fillStyle = background; g.fillRect(0, 0, side, side); }
   const scale = Math.min(side / bitmap.width, side / bitmap.height), w = bitmap.width * scale, h = bitmap.height * scale;
   g.imageSmoothingQuality = "high"; g.drawImage(bitmap, (side - w) / 2, (side - h) / 2, w, h);
   return canvas;
  };
  const png = async (canvas: HTMLCanvasElement, name: string) => { const blob = await blobOf(canvas, "image/png"); if (!blob) throw new Error("The favicon could not be generated."); return new File([blob], name, { type: "image/png" }); };
  return { logo: await encodeLogo(draw(512), "logo-mobile"), favicon: await png(draw(32), "favicon-32.png"), touchIcon: await png(draw(180, "#ffffff"), "apple-touch-icon.png") };
 } finally { bitmap.close(); }
}
function LogoPart({ part, store, version, url }: { part: Part; store: string; version: number; url: string | null }) {
 const [state, dispatch, pending] = useActionState<HomepageTextState, FormData>(saveStoreBranding, {});
 const [ready, setReady] = useState<{ logo: File; favicon?: File; touchIcon?: File; preview: string; icon?: string } | null>(null);
 const [error, setError] = useState("");
 const [sent, setSent] = useState<typeof ready>(null);
 useEffect(() => () => { if (ready) { URL.revokeObjectURL(ready.preview); if (ready.icon) URL.revokeObjectURL(ready.icon); } }, [ready]);
 async function pick(file?: File) {
  setError(""); setReady(null);
  if (!file) return;
  try {
   if (part === "desktop") { const logo = await prepareDesktop(file); setReady({ logo, preview: URL.createObjectURL(logo) }); }
   else { const made = await prepareMobile(file); setReady({ ...made, preview: URL.createObjectURL(made.logo), icon: URL.createObjectURL(made.favicon) }); }
  } catch (e) { setError(e instanceof Error ? e.message : "This logo could not be read."); }
 }
 function send(remove: boolean) {
  const form = new FormData(); form.set("store", store); form.set("version", String(version)); form.set("part", part); form.set("remove", String(remove));
  if (!remove) { if (!ready) { setError("Choose a logo to upload."); return; } form.set("logo", ready.logo); if (ready.favicon) form.set("favicon", ready.favicon); if (ready.touchIcon) form.set("touchIcon", ready.touchIcon); }
  setSent(ready);
  startTransition(() => dispatch(form));
 }
 // Once saved, the refreshed page shows the stored logo; on an error the picked file stays ready to retry.
 const pickedFile = ready && !(sent === ready && state.success && !pending) ? ready : null;
 const shown = pickedFile?.preview ?? url;
 const desktop = part === "desktop";
 return <div className="admin-brand-part"><h3>{desktop ? "Desktop logo" : "Mobile logo & favicon"}</h3>
  <p className="admin-muted">{desktop ? "Wide logo for computers and tablets. Transparent PNG or WebP, at least 1.5× as wide as tall (for example 800×200)." : "Square icon for phones; the browser-tab favicon and home-screen icon are made from it. Transparent PNG or WebP, at least 192×192."}</p>
  <fieldset disabled={pending}>
   <label>{desktop ? "Choose desktop logo" : "Choose square icon"}<input type="file" accept="image/png,image/webp" onChange={e => pick(e.target.files?.[0])} /></label>
   {error && <p role="alert">{error}</p>}
   <div className={"admin-brand-preview " + (desktop ? "is-desktop" : "is-mobile")} aria-label={pickedFile ? "Preview of the new logo in the header" : "Current logo in the header"}>
    {/* eslint-disable-next-line @next/next/no-img-element -- local object URL or public Storage preview */}
    {shown ? <img src={shown} alt="" /> : <span className="admin-muted">Built-in logo</span>}
    <span className="admin-brand-cart" aria-hidden="true">Cart</span>
   </div>
   {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
   {pickedFile?.icon && <p className="admin-brand-favicon"><img src={pickedFile.icon} alt="" width={16} height={16} /> Browser tab icon preview</p>}
   <div className="admin-special-actions">
    <button type="button" className="admin-button" disabled={!pickedFile} onClick={() => send(false)}>{pending ? "Saving…" : pickedFile ? "Save this logo" : "Choose a file to preview"}</button>
    {url && !pickedFile && <button type="button" className="admin-button secondary" onClick={() => send(true)}>Remove (use built-in logo)</button>}
    {pickedFile && <button type="button" className="admin-button secondary" onClick={() => setReady(null)}>Cancel</button>}
   </div>
  </fieldset>
  {state.error && <p role="alert">{state.error}</p>}{state.success && <p role="status">{state.success}</p>}
 </div>;
}
/** Settings → Header logo (ADMIN/OWNER). Each logo falls back to the built-in logo until one is saved. */
export function BrandingForm({ store, version, desktopUrl, mobileUrl }: { store: string; version: number; desktopUrl: string | null; mobileUrl: string | null }) {
 return <section className="admin-branding"><h2>Header logo</h2><p className="admin-muted">Shown at the top of every customer page, next to the cart. Nothing changes until you press Save.</p>
  <div className="admin-brand-grid"><LogoPart part="desktop" store={store} version={version} url={desktopUrl} /><LogoPart part="mobile" store={store} version={version} url={mobileUrl} /></div></section>;
}
