"use client";
import {startTransition, useActionState,useState,useTransition} from "react";
import {manageProductPhotos,saveMaster,saveProductContent,type ActionState} from "@/app/admin/actions";
type Preparation={name:string;cleaning_loss_percent?:number};
type Basis="RAW_WEIGHT"|"NET_WEIGHT"|"UNIT"|"TRAY";
export type EditableProduct={pricing_basis?:string;price_unit_grams?:number;units_per_pack?:number;sale_quantities?:number[];catalogue_price_paise?:number;catalogue_published?:boolean;id:string;category_id:string;name:string;local_name:string;description:string;image_path:string;allowed_weights:number[];preparations:Preparation[];is_active:boolean};
const bases:{value:Basis;label:string}[]=[{value:"RAW_WEIGHT",label:"Raw weight — price per kg"},{value:"NET_WEIGHT",label:"NET weight — price per pack of grams"},{value:"TRAY",label:"Tray — price per tray"},{value:"UNIT",label:"Unit — price per item"}];
const photoLimit=1048576;
/** Converts any browser-readable photo to an 800×800 WebP (letterboxed on white) under 1 MB. */
async function toWebp(file:File){
 const bitmap=await createImageBitmap(file);
 const canvas=document.createElement("canvas");canvas.width=800;canvas.height=800;
 const g=canvas.getContext("2d")!;g.fillStyle="#fff";g.fillRect(0,0,800,800);
 const scale=Math.min(800/bitmap.width,800/bitmap.height),w=bitmap.width*scale,h=bitmap.height*scale;
 g.drawImage(bitmap,(800-w)/2,(800-h)/2,w,h);bitmap.close();
 for(const quality of [0.85,0.75,0.6]){
  const blob=await new Promise<Blob|null>(r=>canvas.toBlob(r,"image/webp",quality));
  if(blob?.type==="image/webp"&&blob.size<=photoLimit)return new File([blob],"photo.webp",{type:"image/webp"});
 }
 throw new Error("This photo could not be converted to WebP under 1 MB.");
}
export function ProductForm({product:p,categories}:{product:EditableProduct|null;categories:{id:string;name:string}[]}){
 const [state,dispatch,pending]=useActionState<ActionState,FormData>(saveMaster,{});
 const [basis,setBasis]=useState<Basis>((p?.pricing_basis as Basis)??"RAW_WEIGHT");
 const [choices,setChoices]=useState<Preparation[]>(p?.preparations?.length?p.preparations:[{name:""}]);
 const [photoError,setPhotoError]=useState("");
 const quantities=(basis==="RAW_WEIGHT"?p?.allowed_weights:p?.sale_quantities)??[];
 const weight=basis==="RAW_WEIGHT"||basis==="NET_WEIGHT";
 const unit=basis==="RAW_WEIGHT"?"kg":basis==="NET_WEIGHT"?"NET pack":basis==="TRAY"?"tray":"item";
 async function submit(form:FormData){
  setPhotoError("");
  const photo=form.get("photo");
  if(photo instanceof File&&photo.size>0){
   try{form.set("photo",await toWebp(photo));}catch(error){setPhotoError(error instanceof Error?error.message:"This photo could not be read.");return;}
  }
  startTransition(() => dispatch(form));
 }
 return <form action={submit} className="admin-live-form"><fieldset disabled={pending}>
  <input type="hidden" name="kind" value="product"/><input type="hidden" name="id" value={p?.id??""}/>
  <input type="hidden" name="image" value={p?.image_path??""}/>
  <label>Name<input name="name" required maxLength={160} defaultValue={p?.name}/></label>
  <label>Local name<input name="local" maxLength={160} defaultValue={p?.local_name}/></label>
  <label>Category<select name="category" required defaultValue={p?.category_id}>{categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
  <label>Description<textarea name="description" maxLength={4000} defaultValue={p?.description}/></label>
  {!p&&<label>Photo<input name="photo" type="file" accept="image/jpeg,image/png,image/webp"/><small>JPEG, PNG or WebP. Saved as an 800×800 WebP under 1 MB and becomes the main photo. Add more photos after saving.</small></label>}
  {photoError&&<p role="alert">{photoError}</p>}
  <label>Sold by<select name="basis" value={basis} onChange={e=>setBasis(e.target.value as Basis)}>{bases.map(b=><option key={b.value} value={b.value}>{b.label}</option>)}</select><small>A product that already has store prices cannot change how it is sold; retire it and create a new product.</small></label>
  {basis==="NET_WEIGHT"&&<label>Grams per priced pack<input type="number" name="unitGrams" required min="1" max="100000" defaultValue={p?.price_unit_grams&&p.pricing_basis==="NET_WEIGHT"?p.price_unit_grams:500}/></label>}
  {(basis==="TRAY"||basis==="UNIT")&&<label>{basis==="TRAY"?"Items per tray":"Items per unit"}<input type="number" name="packCount" required min="1" max="1000" defaultValue={p?.units_per_pack??(basis==="TRAY"?30:1)}/></label>}
  <label>{weight?"Weights customers can choose (grams"+(basis==="NET_WEIGHT"?" NET":"")+", separated by commas)":"Quantities customers can choose ("+unit+"s, separated by commas)"}<input key={basis} name="quantities" required pattern="[0-9, ]+" placeholder={weight?"500, 1000, 1500":"1, 2, 3"} defaultValue={quantities.join(", ")}/></label>
  <label>Reference price (₹ per {unit})<input name="referencePrice" type="number" min="0.01" step="0.01" defaultValue={p?.catalogue_price_paise?p.catalogue_price_paise/100:""}/><small>Store prices are set on Prices &amp; Availability and keep their own history.</small></label>
  <fieldset><legend>Preparation choices</legend>{choices.map((choice,index)=><div key={index}><label>Preparation name<input required maxLength={80} value={choice.name} onChange={e=>setChoices(choices.map((c,i)=>i===index?{...c,name:e.target.value}:c))}/></label><label>Estimated cleaning loss (%) — leave empty when not applicable<input type="number" min="0" max="99.99" step="0.01" value={choice.cleaning_loss_percent??""} onChange={e=>setChoices(choices.map((c,i)=>i===index?{...c,cleaning_loss_percent:e.target.value===""?undefined:Number(e.target.value)}:c))}/></label><button className="admin-button secondary" type="button" disabled={choices.length===1} onClick={()=>setChoices(choices.filter((_,i)=>i!==index))}>Remove preparation</button></div>)}<button type="button" className="admin-button secondary" onClick={()=>setChoices([...choices,{name:""}])}>Add preparation</button></fieldset>
  <input type="hidden" name="preparations" value={JSON.stringify(choices)}/>
  <label>Status<select name="active" defaultValue={String(p?.is_active??true)}><option value="true">Active</option><option value="false">Retired / inactive</option></select><small>Active products can be sold in stores that offer them. Retired products leave the website and stop selling; order history is kept.</small></label>
  <label>Approved catalogue listing<select name="published" defaultValue={String(p?.catalogue_published??false)}><option value="true">Listed</option><option value="false">Not listed</option></select><small>Lists the product, at its reference price, in the business-wide catalogue used when no store is connected and when setting up new stores. It does not change what a store sells today.</small></label>
  <button className="admin-button">{pending?"Saving…":"Save product"}</button>
 </fieldset>{state.error&&<p role="alert">{state.error}</p>}{state.success&&<p role="status">{state.success}</p>}</form>;
}
export type ContentProduct={id:string;name:string;local_name:string;description:string;category:string|null;is_active:boolean;photo:string|null;image_path:string};
/** OWNER (and ADMIN): photo, local name and description only. Every other product field is ADMIN-only. */
export function ProductContentForm({product:p}:{product:ContentProduct}){
 const [state,dispatch,pending]=useActionState<ActionState,FormData>(saveProductContent,{});
 const [photoError,setPhotoError]=useState("");
 async function submit(form:FormData){
  setPhotoError("");
  const photo=form.get("photo");
  if(photo instanceof File&&photo.size>0){
   try{form.set("photo",await toWebp(photo));}catch(error){setPhotoError(error instanceof Error?error.message:"This photo could not be read.");return;}
  }
  startTransition(() => dispatch(form));
 }
 return <form action={submit} className="admin-live-form"><fieldset disabled={pending}>
  <input type="hidden" name="id" value={p.id}/><input type="hidden" name="name" value={p.name}/>
  <p><strong>{p.name}</strong>{p.category?" · "+p.category:""}{p.is_active?"":" · Retired"}</p>
  {photoError&&<p role="alert">{photoError}</p>}
  <label>Local name<input name="local" maxLength={160} defaultValue={p.local_name}/></label>
  <label>Description<textarea name="description" maxLength={4000} defaultValue={p.description}/></label>
  <p className="admin-muted">Name, category, pricing, preparations and status are managed by ADMIN.</p>
  <button className="admin-button">{pending?"Saving…":"Save"}</button>
 </fieldset>{state.error&&<p role="alert">{state.error}</p>}{state.success&&<p role="status">{state.success}</p>}</form>;
}
export type GalleryPhoto={id:string;url:string;alt:string};
export const photoLimitCount=5;
/** ADMIN and OWNER: up to 5 photos per product. The first is the main photo (cards and link previews use it);
 *  the rest follow in this order in the product popup. Removing hides a photo; the file is kept. */
export function ProductPhotos({product,name,photos}:{product:string;name:string;photos:GalleryPhoto[]}){
 const [pending,start]=useTransition();
 const [message,setMessage]=useState<ActionState>({});
 const [confirming,setConfirming]=useState("");
 function run(fields:Record<string,string|File>){
  const form=new FormData();form.set("product",product);
  for(const [k,v] of Object.entries(fields))form.set(k,v);
  setConfirming("");
  start(async()=>{setMessage(await manageProductPhotos({},form));});
 }
 function arrange(order:GalleryPhoto[]){run({operation:"arrange",photos:order.map(x=>x.id).join(",")});}
 function move(from:number,to:number){const order=[...photos];const [x]=order.splice(from,1);order.splice(to,0,x);arrange(order);}
 async function add(files:FileList|null){
  const list=Array.from(files??[]).slice(0,photoLimitCount-photos.length);
  setMessage({});
  for(const file of list){
   let photo:File;
   try{photo=await toWebp(file);}catch(error){setMessage({error:error instanceof Error?error.message:"This photo could not be read."});return;}
   const form=new FormData();form.set("product",product);form.set("operation","add");form.set("alt",name);form.set("photo",photo);
   const result=await new Promise<ActionState>(resolve=>start(async()=>{resolve(await manageProductPhotos({},form));}));
   setMessage(result);if(result.error)return;
  }
 }
 return <fieldset className="admin-photos" disabled={pending}><legend>Photos <small>{photos.length}/{photoLimitCount}</small></legend>
  {photos.length?<ol className="admin-photo-list">{photos.map((photo,i)=><li key={photo.id}>
   {/* eslint-disable-next-line @next/next/no-img-element */}
   <img src={photo.url} alt={photo.alt||name} width={120} height={120}/>
   {i===0?<span className="admin-photo-main">Main photo</span>:<button type="button" className="admin-button secondary" onClick={()=>move(i,0)}>Set as main</button>}
   <div className="admin-photo-actions">
    {i>1&&<button type="button" className="admin-button secondary" aria-label={"Move photo "+(i+1)+" earlier"} onClick={()=>move(i,i-1)}>←</button>}
    {i>0&&i<photos.length-1&&<button type="button" className="admin-button secondary" aria-label={"Move photo "+(i+1)+" later"} onClick={()=>move(i,i+1)}>→</button>}
    {confirming===photo.id?<button type="button" className="admin-button" onClick={()=>run({operation:"remove",photo:photo.id})}>Confirm remove</button>
     :<button type="button" className="admin-button secondary" onClick={()=>setConfirming(photo.id)}>Remove<span className="sr-only"> photo {i+1}</span></button>}
   </div>
  </li>)}</ol>:<p className="admin-muted">No photos yet. The shop shows a placeholder.</p>}
  {photos.length<photoLimitCount&&<label>Add photos<input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={e=>{const files=e.currentTarget.files;void add(files).finally(()=>{e.target.value="";});}}/><small>JPEG, PNG or WebP, up to {photoLimitCount-photos.length} more. Each is saved as an 800×800 WebP under 1 MB. The first photo is the main photo on product cards.</small></label>}
  {pending&&<p role="status">Saving photos…</p>}
  {message.error&&<p role="alert">{message.error}</p>}{!pending&&message.success&&<p role="status">{message.success}</p>}
 </fieldset>;
}
