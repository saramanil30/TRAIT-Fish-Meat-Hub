"use client";
import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { saveLinkPreview, type HomepageTextState } from "@/app/admin/homepage-actions";
import { defaultLinkPreview, linkPreviewLimits, type LinkPreviewStyle } from "@/lib/link-preview";
import { shareImageLimitBytes, squareShareBounds } from "@/lib/share-image";
/** Any JPG/PNG/WebP photo → a 1200×630 JPG of at most 300 KB: the whole photo is fitted (never cropped) and centred on
 *  white, then saved at the highest quality that fits. The server checks the bytes again before upload. */
async function toShareJpeg(file: File) {
 if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error("Choose a JPG, PNG or WebP image.");
 const bitmap = await createImageBitmap(file).catch(() => null);
 if (!bitmap) throw new Error("This image could not be read.");
 const canvas = document.createElement("canvas"); canvas.width = 1200; canvas.height = 630;
 const g = canvas.getContext("2d")!;
 g.fillStyle = "#ffffff"; g.fillRect(0, 0, 1200, 630);
 const scale = Math.min(1200 / bitmap.width, 630 / bitmap.height), w = bitmap.width * scale, h = bitmap.height * scale;
 g.imageSmoothingQuality = "high"; g.drawImage(bitmap, (1200 - w) / 2, (630 - h) / 2, w, h); bitmap.close();
 return jpegUnderLimit(canvas, "share.jpg");
}
/** Compact preview: a square JPG of 400–1200 px (the image's own size, at least 400), at most 300 KB. A square image is
 *  used whole; any other shape is cropped to its centre square, never fitted onto a white card. Only transparent
 *  pixels (e.g. a PNG icon) get a white background, because JPG has no transparency. */
async function toSquareJpeg(source: Blob) {
 if (!/^image\/(jpeg|png|webp)$/.test(source.type)) throw new Error("Choose a JPG, PNG or WebP image.");
 const bitmap = await createImageBitmap(source).catch(() => null);
 if (!bitmap) throw new Error("This image could not be read.");
 const crop = Math.min(bitmap.width, bitmap.height), side = Math.max(squareShareBounds.min, Math.min(squareShareBounds.max, crop));
 const canvas = document.createElement("canvas"); canvas.width = side; canvas.height = side;
 const g = canvas.getContext("2d")!;
 g.fillStyle = "#ffffff"; g.fillRect(0, 0, side, side);
 g.imageSmoothingQuality = "high"; g.drawImage(bitmap, (bitmap.width - crop) / 2, (bitmap.height - crop) / 2, crop, crop, 0, 0, side, side); bitmap.close();
 return { file: await jpegUnderLimit(canvas, "share-square.jpg"), side };
}
async function jpegUnderLimit(canvas: HTMLCanvasElement, name: string) {
 for (const quality of [0.92, 0.86, 0.8, 0.72, 0.64, 0.55, 0.45, 0.35]) {
  const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, "image/jpeg", quality));
  if (blob?.type === "image/jpeg" && blob.size <= shareImageLimitBytes) return new File([blob], name, { type: "image/jpeg" });
 }
 throw new Error("This image could not be saved under 300 KB. Try a simpler image.");
}
type Square={file:File;url:string;side:number;fromIcon:boolean};
/** Settings → Link preview: what WhatsApp, Facebook and X show when someone shares the site link. Compact (default) uses a
 *  square image, made from the square header icon unless another image is chosen; Large banner uses the 1200×630 image. */
export function LinkPreviewForm({store,title,description,imagePath,imageUrl,version,site,style:savedStyle,squarePath,squareSize,squareUrl,headerIconUrl}:{store:string;title?:string;description?:string;imagePath?:string;imageUrl?:string|null;version:number;site:string;style?:LinkPreviewStyle;squarePath?:string;squareSize?:number;squareUrl?:string|null;headerIconUrl?:string|null}) {
 const [state,action,pending]=useActionState<HomepageTextState,FormData>(saveLinkPreview,{});
 const [draft,setDraft]=useState({title:title??"",description:description??""});
 const [style,setStyle]=useState<LinkPreviewStyle>(savedStyle??"COMPACT");
 const [picked,setPicked]=useState<{file:File;url:string}|null>(null);
 const [square,setSquare]=useState<Square|null>(null);
 const [imageError,setImageError]=useState<string|null>(null);
 const [converting,setConverting]=useState(false);
 const [remove,setRemove]=useState(false);
 const iconTried=useRef(false);
 useEffect(()=>()=>{if(picked)URL.revokeObjectURL(picked.url);},[picked]);
 useEffect(()=>()=>{if(square)URL.revokeObjectURL(square.url);},[square]);
 // Compact with no saved square image: prepare one from the square header icon (saved as a JPG when you press Save).
 useEffect(()=>{
  if(style!=="COMPACT"||squarePath||square||!headerIconUrl||iconTried.current)return;
  iconTried.current=true;
  let live=true;
  (async()=>{
   setConverting(true);
   try{const r=await fetch(headerIconUrl,{cache:"no-store"});if(!r.ok)throw new Error();const s=await toSquareJpeg(await r.blob());if(live)setSquare({...s,url:URL.createObjectURL(s.file),fromIcon:true});}
   catch{if(live)setImageError("The header icon could not be read. Choose a square image below instead.");}
   finally{if(live)setConverting(false);}
  })();
  return ()=>{live=false;};
 },[style,squarePath,square,headerIconUrl]);
 const compact=style==="COMPACT";
 const shown=compact?square?.url??squareUrl??defaultLinkPreview.image.url:picked?.url??(!remove&&imageUrl?imageUrl:defaultLinkPreview.image.url);
 // Sends the converted JPGs (never the original files); the file inputs themselves have no name.
 function submit(form:FormData){if(converting)return;form.delete("imageFile");form.delete("squareFile");if(picked)form.set("imageFile",picked.file);if(square)form.set("squareFile",square.file);startTransition(()=>action(form));}
 const clean=(v:string)=>v.replace(/[<>]/g,"");
 return <section className="link-preview-settings"><h2>Link preview</h2><p className="admin-muted">What WhatsApp, Facebook and X show when someone shares your site link. Leave text blank to use the text shown in grey.</p>
  <form action={submit} className="admin-live-form"><input type="hidden" name="store" value={store}/><input type="hidden" name="version" value={state.version??version}/><input type="hidden" name="image" value={imagePath??""}/><input type="hidden" name="removeImage" value={String(remove)}/><input type="hidden" name="style" value={style}/><input type="hidden" name="squareImage" value={squarePath??""}/><input type="hidden" name="squareSize" value={squareSize??""}/><fieldset disabled={pending}>
   <fieldset className="link-style-options"><legend>Preview style</legend>
    <label className="admin-checkbox"><input type="radio" name="styleChoice" checked={compact} onChange={()=>setStyle("COMPACT")}/> Compact (square image, small card)</label>
    <label className="admin-checkbox"><input type="radio" name="styleChoice" checked={!compact} onChange={()=>setStyle("LARGE")}/> Large banner (1200×630 image, big card)</label>
   </fieldset>
   {compact?<>
    <label>Compact image<input type="file" accept="image/jpeg,image/png,image/webp" onChange={async e=>{const file=e.target.files?.[0];setImageError(null);if(!file)return;setConverting(true);try{const s=await toSquareJpeg(file);setSquare({...s,url:URL.createObjectURL(s.file),fromIcon:false});}catch(error){setImageError(error instanceof Error?error.message:"This image could not be read.");}finally{setConverting(false);}}}/><span>By default your square header icon is used. Or choose any JPG, PNG or WebP: a square image is used whole, other shapes are cropped to the centre square. Saved as a square JPG of at least 400×400, under 300 KB.</span></label>
    {square&&<p className="admin-muted">Ready: {square.fromIcon?"your header icon as a ":""}{square.side}×{square.side} JPG, {Math.ceil(square.file.size/1024)} KB. Not saved yet.</p>}
    {!square&&!squarePath&&!headerIconUrl&&<p className="admin-muted">No square header icon is set, so the built-in logo is used until you choose an image.</p>}
   </>:<>
    <label>Banner image<input type="file" accept="image/jpeg,image/png,image/webp" onChange={async e=>{const file=e.target.files?.[0];setImageError(null);setPicked(null);if(!file)return;setConverting(true);try{const jpg=await toShareJpeg(file);setRemove(false);setPicked({file:jpg,url:URL.createObjectURL(jpg)});}catch(error){setImageError(error instanceof Error?error.message:"This image could not be read.");}finally{setConverting(false);}}}/><span>Any JPG, PNG or WebP. It is fitted onto a white 1200×630 card and saved as a JPG under 300 KB. Check the preview below, then save.</span></label>
    {picked&&<p className="admin-muted">Ready: 1200×630 JPG, {Math.ceil(picked.file.size/1024)} KB. Not saved yet.</p>}
    {imagePath&&!picked&&<label className="admin-checkbox"><input type="checkbox" checked={remove} onChange={e=>setRemove(e.target.checked)}/> Remove the current banner (use the built-in image)</label>}
   </>}
   {converting&&<p role="status">Preparing the image…</p>}
   {imageError&&<p role="alert">{imageError}</p>}
   <label>Share title<input name="title" maxLength={linkPreviewLimits.title} placeholder={defaultLinkPreview.title} value={draft.title} onChange={e=>setDraft({...draft,title:clean(e.target.value)})}/><small className="admin-muted">{draft.title.length}/{linkPreviewLimits.title}</small></label>
   <label>Share description<textarea name="description" rows={3} maxLength={linkPreviewLimits.description} placeholder={defaultLinkPreview.description} value={draft.description} onChange={e=>setDraft({...draft,description:clean(e.target.value)})}/><small className="admin-muted">{draft.description.length}/{linkPreviewLimits.description} · keep it short: WhatsApp shows about one line</small></label>
   <button className="admin-button" disabled={converting}>{pending?"Saving…":"Save link preview"}</button></fieldset>
   {state.error&&<p role="alert">{state.error}</p>}{state.success&&<p role="status">{state.success}</p>}</form>
  <h3>Preview</h3>
  {/* eslint-disable-next-line @next/next/no-img-element -- local object URLs and storage URLs; this card is a preview only */}
  <div className={"share-card"+(compact?" share-card-compact":"")} aria-label="Shared link preview"><img src={shown} alt="" /><div><small>{site.replace(/^https?:\/\//,"")}</small><strong>{draft.title.trim()||defaultLinkPreview.title}</strong><p>{draft.description.trim()||defaultLinkPreview.description}</p></div></div></section>;
}
/** Phone share sheet: photo + message + site link (Web Share API with files); link-only share or WhatsApp where files can't be shared. */
export function ShareToWhatsApp({site,title}:{site:string;title?:string}) {
 const [file,setFile]=useState<File|null>(null);
 const [message,setMessage]=useState((title||"Fresh fish, chicken & mutton, cleaned and cut your way")+". Order online: "+site);
 const [status,setStatus]=useState<string|null>(null);
 async function share(){
  setStatus(null);
  const text=message.includes(site)?message:message.trim()+" "+site;
  try{
   if(file&&navigator.canShare?.({files:[file]})){await navigator.share({files:[file],text});setStatus("Shared with the photo.");return;}
   const note=file?"This browser can't share photos, so only the message and link were shared.":null;
   if(navigator.share){await navigator.share({text});setStatus(note??"Shared.");return;}
   window.open("https://wa.me/?text="+encodeURIComponent(text),"_blank","noopener");
   setStatus(note??"Opened WhatsApp with the message and link.");
  }catch(error){if(!(error instanceof DOMException&&error.name==="AbortError"))setStatus("Sharing failed. Try again, or copy the link: "+site);}
 }
 return <section className="share-whatsapp"><h2>Share to WhatsApp</h2><p className="admin-muted">Best on your phone: pick a photo, edit the message, then choose WhatsApp in the share sheet. The site link is added to the message.</p>
  <div className="admin-live-form"><fieldset><label>Photo (optional)<input type="file" accept="image/*" onChange={e=>setFile(e.target.files?.[0]??null)}/></label>
  <label>Message<textarea rows={3} maxLength={500} value={message} onChange={e=>setMessage(e.target.value)}/></label>
  <button type="button" className="admin-button whatsapp-share-button" onClick={share}>Share to WhatsApp</button></fieldset>{status&&<p role="status">{status}</p>}</div></section>;
}
