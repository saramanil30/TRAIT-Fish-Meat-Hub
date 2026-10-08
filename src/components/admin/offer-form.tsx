"use client";
import { startTransition,useActionState,useState } from "react";
import { saveOffer } from "@/app/admin/offer-actions";
export type OfferRecord={id:string;title:string;message:string;discount_kind:string;discount_value:number;starts_at:string;ends_at:string;scope:string;product_ids:string[];category_ids:string[];is_active:boolean;version:number;code?:string;min_order_paise?:number;max_discount_paise?:number|null;image_path?:string|null};
type Choice={id:string;name:string};
const imageLimit=1048576;
/** Converts a banner photo to WebP under 1 MB, at most 1200×800, keeping its shape. */
async function toWebp(file:File){
 const bitmap=await createImageBitmap(file);
 const scale=Math.min(1,1200/bitmap.width,800/bitmap.height),w=Math.round(bitmap.width*scale),h=Math.round(bitmap.height*scale);
 const canvas=document.createElement("canvas");canvas.width=w;canvas.height=h;
 canvas.getContext("2d")!.drawImage(bitmap,0,0,w,h);bitmap.close();
 for(const quality of [0.85,0.75,0.6]){
  const blob=await new Promise<Blob|null>(r=>canvas.toBlob(r,"image/webp",quality));
  if(blob?.type==="image/webp"&&blob.size<=imageLimit)return new File([blob],"offer.webp",{type:"image/webp"});
 }
 throw new Error("This image could not be converted to WebP under 1 MB.");
}
/** India date and time parts ("2026-10-09", "18:30") of a stored timestamp. */
function istParts(iso:string){const local=new Date(new Date(iso).getTime()+330*60000).toISOString();return {date:local.slice(0,10),time:local.slice(11,16)};}
export function OfferForm({offer,store,products,categories,imageBase}:{offer?:OfferRecord;store:string;products:Choice[];categories:Choice[];imageBase?:string}) {
 const [state,dispatch,pending]=useActionState(saveOffer,{});
 const [scope,setScope]=useState(offer?.scope??"STORE");
 const [kind,setKind]=useState(offer?.discount_kind??"PERCENT");
 const [imageError,setImageError]=useState("");
 const start=offer?istParts(offer.starts_at):undefined,end=offer?istParts(offer.ends_at):undefined;
 const rupees=(paise?:number|null)=>paise?paise/100:undefined;
 async function submit(form:FormData){
  setImageError("");
  const image=form.get("imageFile");
  if(image instanceof File&&image.size>0){
   try{form.set("imageFile",await toWebp(image));}catch(error){setImageError(error instanceof Error?error.message:"This image could not be read.");return;}
  }
  startTransition(()=>dispatch(form));
 }
 return <form action={submit} className="admin-live-form"><fieldset disabled={pending}><input type="hidden" name="id" value={offer?.id??""}/><input type="hidden" name="version" value={offer?.version??""}/><input type="hidden" name="store" value={store}/><input type="hidden" name="image" value={offer?.image_path??""}/>
 <label>Offer title<input name="title" required maxLength={160} defaultValue={offer?.title}/></label><label>Coupon code<input name="code" required minLength={3} maxLength={20} pattern="[A-Za-z0-9]{3,20}" autoCapitalize="characters" style={{textTransform:"uppercase"}} defaultValue={offer?.code}/><span>3–20 letters or numbers, e.g. SAVE10. Customers enter or pick this code in the cart.</span></label><label>Message<textarea name="message" maxLength={1000} defaultValue={offer?.message}/></label>
 <label>Discount type<select name="kind" value={kind} onChange={e=>setKind(e.target.value)}><option value="PERCENT">Percent (%)</option><option value="FIXED">Flat amount (₹)</option></select></label>
 <label>{kind==="PERCENT"?"Discount (%)":"Discount amount (₹)"}<input key={kind} name="amount" type="number" min={kind==="PERCENT"?"0.01":"1"} max={kind==="PERCENT"?100:1000000} step={kind==="PERCENT"?"0.01":"1"} required defaultValue={offer&&offer.discount_kind===kind?offer.discount_value/100:undefined}/>{kind==="FIXED"&&<span>Whole rupees, taken off once per order.</span>}</label>
 <label>Minimum order (₹)<input name="minOrder" type="number" min="0" max="1000000" step="1" placeholder="No minimum" defaultValue={rupees(offer?.min_order_paise)}/><span>Optional. The coupon works once the items it covers add up to this amount.</span></label>
 {kind==="PERCENT"&&<label>Maximum discount (₹)<input name="maxDiscount" type="number" min="1" max="1000000" step="1" placeholder="No limit" defaultValue={rupees(offer?.max_discount_paise)}/><span>Optional. The percent discount never goes above this.</span></label>}
 <p>Dates are India time (IST). Leave a time blank to start at 00:00 or end at 23:59.</p>
 <div className="admin-date-time"><label>Start date<input name="startDate" type="date" required defaultValue={start?.date}/></label><label>Start time<input name="startTime" type="time" defaultValue={start&&start.time!=="00:00"?start.time:undefined}/></label></div>
 <div className="admin-date-time"><label>End date<input name="endDate" type="date" required defaultValue={end?.date}/></label><label>End time<input name="endTime" type="time" defaultValue={end&&end.time!=="23:59"?end.time:undefined}/></label></div>
 <label>Applies to<select name="scope" value={scope} onChange={e=>setScope(e.target.value)}><option value="STORE">Whole store</option><option value="PRODUCTS">Selected products</option><option value="CATEGORIES">Selected categories (including subcategories)</option></select></label>
 {scope!=="STORE"&&<label>{scope==="PRODUCTS"?"Products":"Categories"}<select key={scope} name={scope==="PRODUCTS"?"products":"categories"} multiple required defaultValue={scope==="PRODUCTS"?offer?.product_ids:offer?.category_ids}>{(scope==="PRODUCTS"?products:categories).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select><span>Choose one or more. Use Ctrl/Command to select multiple options.</span></label>}
 <label>Banner image<input name="imageFile" type="file" accept="image/jpeg,image/png,image/webp"/><span>Optional. JPEG, PNG or WebP; saved as WebP under 1 MB and shown beside this offer on the homepage.</span></label>
 {offer?.image_path&&<div className="admin-offer-image">
  {/* eslint-disable-next-line @next/next/no-img-element -- public Storage preview */}
  {imageBase&&<img src={imageBase+offer.image_path} alt="" width={160} height={96}/>}<label><input type="checkbox" name="removeImage" value="true"/> Remove current image</label></div>}
 {imageError&&<p role="alert">{imageError}</p>}
 <label>Status<select name="active" defaultValue={String(offer?.is_active??false)}><option value="false">Inactive</option><option value="true">Active during scheduled dates</option></select></label>
 <p>A discount applies only when the customer applies this code. One coupon per order; discounts exclude delivery and are rounded to whole rupees.</p><button className="admin-button">{pending?"Saving…":"Save offer"}</button></fieldset>{state.error&&<p role="alert">{state.error}</p>}{state.success&&<p role="status">{state.success}</p>}</form>;
}
