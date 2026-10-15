"use client";
import { startTransition, useActionState, useState } from "react";
import { saveCategoryPhoto, saveHomepageLinks, saveHomepageSpecials, type HomepageTextState } from "@/app/admin/homepage-actions";
import { maxSpecials, specialBadges, type SpecialBadge } from "@/lib/homepage-content";
const photoLimit=1048576;
/** Square 600×600 WebP under 1 MB, centre-cropped to fill the circle. */
async function toSquareWebp(file:File){
 const bitmap=await createImageBitmap(file);
 const side=Math.min(bitmap.width,bitmap.height);
 const canvas=document.createElement("canvas");canvas.width=600;canvas.height=600;
 canvas.getContext("2d")!.drawImage(bitmap,(bitmap.width-side)/2,(bitmap.height-side)/2,side,side,0,0,600,600);bitmap.close();
 for(const quality of [0.85,0.75,0.6]){
  const blob=await new Promise<Blob|null>(r=>canvas.toBlob(r,"image/webp",quality));
  if(blob?.type==="image/webp"&&blob.size<=photoLimit)return new File([blob],"category.webp",{type:"image/webp"});
 }
 throw new Error("This photo could not be converted to WebP under 1 MB.");
}
function Result({state}:{state:HomepageTextState}){return <>{state.error&&<p role="alert">{state.error}</p>}{state.success&&<p role="status">{state.success}</p>}</>;}

/** Instagram and Facebook links; the top bar shows an icon only for a link that is set. */
export function SocialLinksForm({store,instagram,facebook,version}:{store:string;instagram?:string;facebook?:string;version:number}){
 const [state,action,pending]=useActionState<HomepageTextState,FormData>(saveHomepageLinks,{});
 return <section><h2>Social links</h2><p className="admin-muted">Shown as icons in the top bar of every customer page. Leave blank to hide an icon.</p>
  <form action={action} className="admin-live-form"><input type="hidden" name="store" value={store}/><input type="hidden" name="version" value={state.version??version}/><fieldset disabled={pending}>
   <label>Instagram URL<input name="instagram" type="url" inputMode="url" maxLength={300} placeholder="https://www.instagram.com/yourpage" defaultValue={instagram}/></label>
   <label>Facebook URL<input name="facebook" type="url" inputMode="url" maxLength={300} placeholder="https://www.facebook.com/yourpage" defaultValue={facebook}/></label>
   <button className="admin-button">{pending?"Saving…":"Save social links"}</button></fieldset><Result state={state}/></form></section>;
}

type Row={key:string;product:string;badge:SpecialBadge|"";was:string};
export type SpecialChoice={id:string;name:string;active:boolean};
/** Today's Specials: pick products in display order, each with an optional badge and "Was ₹" strike price. */
export function SpecialsForm({store,version,saved,products}:{store:string;version:number;saved:{productId:string;badge:SpecialBadge|null;wasPaise:number|null}[];products:SpecialChoice[]}){
 const [state,action,pending]=useActionState<HomepageTextState,FormData>(saveHomepageSpecials,{});
 const [rows,setRows]=useState<Row[]>(saved.map(s=>({key:s.productId,product:s.productId,badge:s.badge??"",was:s.wasPaise?String(s.wasPaise/100):""})));
 const choices=products.filter(p=>p.active);
 const set=(n:number,patch:Partial<Row>)=>setRows(rows.map((r,i)=>i===n?{...r,...patch}:r));
 const move=(n:number,by:number)=>{const next=[...rows];[next[n],next[n+by]]=[next[n+by],next[n]];setRows(next);};
 return <section><h2>Today&apos;s Specials</h2><p className="admin-muted">Products shown in the Today&apos;s Specials row on the homepage, in this order (up to {maxSpecials}). Sold-out or unpublished products are hidden automatically. The &quot;Was ₹&quot; price shows struck through only when it is higher than today&apos;s price; enter it per the product&apos;s price unit (per kg, tray or unit).</p>
  <form action={action} className="admin-live-form"><input type="hidden" name="store" value={store}/><input type="hidden" name="version" value={state.version??version}/><fieldset disabled={pending}>
   {rows.map((r,n)=><div key={r.key} className="admin-special-row">
    <label>Product<select name="product" required value={r.product} onChange={e=>set(n,{product:e.target.value})}><option value="">Choose a product</option>{choices.map(p=><option key={p.id} value={p.id} disabled={p.id!==r.product&&rows.some(x=>x.product===p.id)}>{p.name}</option>)}</select></label>
    <label>Badge<select name="badge" value={r.badge} onChange={e=>set(n,{badge:e.target.value as SpecialBadge|""})}><option value="">No badge</option>{(Object.keys(specialBadges) as SpecialBadge[]).map(b=><option key={b} value={b}>{specialBadges[b]}</option>)}</select></label>
    <label>Was ₹ (optional)<input name="was" type="number" min="0.01" max="1000000" step="0.01" inputMode="decimal" placeholder="e.g. 2400" value={r.was} onChange={e=>set(n,{was:e.target.value})}/></label>
    <div className="admin-special-actions"><button type="button" className="admin-button secondary" disabled={n===0} onClick={()=>move(n,-1)} aria-label={"Move row "+(n+1)+" up"}>↑</button><button type="button" className="admin-button secondary" disabled={n===rows.length-1} onClick={()=>move(n,1)} aria-label={"Move row "+(n+1)+" down"}>↓</button><button type="button" className="admin-button secondary" onClick={()=>setRows(rows.filter((_,i)=>i!==n))}>Remove</button></div>
   </div>)}
   {!rows.length&&<p className="admin-muted">No specials chosen. The homepage shows the first available products until you choose some.</p>}
   <div className="admin-special-actions"><button type="button" className="admin-button secondary" disabled={rows.length>=maxSpecials} onClick={()=>setRows([...rows,{key:crypto.randomUUID(),product:"",badge:"",was:""}])}>Add product</button><button className="admin-button">{pending?"Saving…":"Save Today's Specials"}</button></div>
  </fieldset><Result state={state}/></form></section>;
}

export type CategoryPhotoRecord={id:string;name:string;active:boolean;photo:string|null;version:number};
/** One category circle: current photo (or the built-in image), upload a new one, or remove it. */
export function CategoryPhotoForm({category,imageUrl}:{category:CategoryPhotoRecord;imageUrl:string|null}){
 const [state,dispatch,pending]=useActionState<HomepageTextState,FormData>(saveCategoryPhoto,{});
 const [error,setError]=useState("");
 async function submit(form:FormData){
  setError("");
  if(form.get("remove")!=="true"){
   const file=form.get("photo");
   if(!(file instanceof File)||!file.size){setError("Choose a photo to upload.");return;}
   try{form.set("photo",await toSquareWebp(file));}catch(e){setError(e instanceof Error?e.message:"This photo could not be read.");return;}
  }
  startTransition(()=>dispatch(form));
 }
 return <form action={submit} className="admin-category-photo"><input type="hidden" name="category" value={category.id}/><input type="hidden" name="version" value={state.version??category.version}/>
  <div className="admin-category-circle">{imageUrl?
   // eslint-disable-next-line @next/next/no-img-element -- public Storage preview
   <img src={imageUrl} alt="" width={72} height={72}/>:<span>Built-in</span>}</div>
  <fieldset disabled={pending}><strong>{category.name}{!category.active&&" (inactive)"}</strong>
   <label>New photo<input name="photo" type="file" accept="image/jpeg,image/png,image/webp"/><span className="admin-muted">Cropped to a square and saved as WebP.</span></label>
   <div className="admin-special-actions"><button className="admin-button" name="remove" value="false">{pending?"Saving…":"Upload photo"}</button>{category.photo&&<button className="admin-button secondary" name="remove" value="true">Remove photo</button>}</div>
  </fieldset>{error&&<p role="alert">{error}</p>}<Result state={state}/></form>;
}
