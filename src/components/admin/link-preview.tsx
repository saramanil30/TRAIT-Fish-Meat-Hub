"use client";
import { startTransition, useActionState, useEffect, useState } from "react";
import { saveLinkPreview, type HomepageTextState } from "@/app/admin/homepage-actions";
import { defaultLinkPreview, linkPreviewLimits } from "@/lib/link-preview";
import { shareImageLimitBytes } from "@/lib/share-image";
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
 for (const quality of [0.92, 0.86, 0.8, 0.72, 0.64, 0.55, 0.45, 0.35]) {
  const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, "image/jpeg", quality));
  if (blob?.type === "image/jpeg" && blob.size <= shareImageLimitBytes) return new File([blob], "share.jpg", { type: "image/jpeg" });
 }
 throw new Error("This image could not be saved under 300 KB. Try a simpler image.");
}
/** Settings → Link preview: what WhatsApp, Facebook and X show when someone shares the site link. */
export function LinkPreviewForm({store,title,description,imagePath,imageUrl,version,site}:{store:string;title?:string;description?:string;imagePath?:string;imageUrl?:string|null;version:number;site:string}) {
 const [state,action,pending]=useActionState<HomepageTextState,FormData>(saveLinkPreview,{});
 const [draft,setDraft]=useState({title:title??"",description:description??""});
 const [picked,setPicked]=useState<{file:File;url:string}|null>(null);
 const [imageError,setImageError]=useState<string|null>(null);
 const [converting,setConverting]=useState(false);
 const [remove,setRemove]=useState(false);
 useEffect(()=>()=>{if(picked)URL.revokeObjectURL(picked.url);},[picked]);
 const shown=picked?.url??(!remove&&imageUrl?imageUrl:defaultLinkPreview.image.url);
 // Sends the converted JPG (never the original file); the picked file input itself has no name.
 function submit(form:FormData){if(imageError||converting)return;form.delete("imageFile");if(picked)form.set("imageFile",picked.file);startTransition(()=>action(form));}
 const clean=(v:string)=>v.replace(/[<>]/g,"");
 return <section className="link-preview-settings"><h2>Link preview</h2><p className="admin-muted">What WhatsApp, Facebook and X show when someone shares your site link. Leave text blank to use the text shown in grey.</p>
  <form action={submit} className="admin-live-form"><input type="hidden" name="store" value={store}/><input type="hidden" name="version" value={state.version??version}/><input type="hidden" name="image" value={imagePath??""}/><input type="hidden" name="removeImage" value={String(remove)}/><fieldset disabled={pending}>
   <label>Share image<input type="file" accept="image/jpeg,image/png,image/webp" onChange={async e=>{const file=e.target.files?.[0];setImageError(null);setPicked(null);if(!file)return;setConverting(true);try{const jpg=await toShareJpeg(file);setRemove(false);setPicked({file:jpg,url:URL.createObjectURL(jpg)});}catch(error){setImageError(error instanceof Error?error.message:"This image could not be read.");}finally{setConverting(false);}}}/><span>Any JPG, PNG or WebP. It is fitted onto a white 1200×630 card and saved as a JPG under 300 KB. Check the preview below, then save.</span></label>
   {converting&&<p role="status">Preparing the image…</p>}
   {picked&&<p className="admin-muted">Ready: 1200×630 JPG, {Math.ceil(picked.file.size/1024)} KB. Not saved yet.</p>}
   {imageError&&<p role="alert">{imageError}</p>}
   {imagePath&&!picked&&<label className="admin-checkbox"><input type="checkbox" checked={remove} onChange={e=>setRemove(e.target.checked)}/> Remove the current image (use the built-in one)</label>}
   <label>Share title<input name="title" maxLength={linkPreviewLimits.title} placeholder={defaultLinkPreview.title} value={draft.title} onChange={e=>setDraft({...draft,title:clean(e.target.value)})}/><small className="admin-muted">{draft.title.length}/{linkPreviewLimits.title}</small></label>
   <label>Share description<textarea name="description" rows={3} maxLength={linkPreviewLimits.description} placeholder={defaultLinkPreview.description} value={draft.description} onChange={e=>setDraft({...draft,description:clean(e.target.value)})}/><small className="admin-muted">{draft.description.length}/{linkPreviewLimits.description}</small></label>
   <button className="admin-button" disabled={converting}>{pending?"Saving…":"Save link preview"}</button></fieldset>
   {state.error&&<p role="alert">{state.error}</p>}{state.success&&<p role="status">{state.success}</p>}</form>
  <h3>Preview</h3>
  {/* eslint-disable-next-line @next/next/no-img-element -- local object URLs and storage URLs; this card is a preview only */}
  <div className="share-card" aria-label="Shared link preview"><img src={shown} alt="" /><div><small>{site.replace(/^https?:\/\//,"")}</small><strong>{draft.title.trim()||defaultLinkPreview.title}</strong><p>{draft.description.trim()||defaultLinkPreview.description}</p></div></div></section>;
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
