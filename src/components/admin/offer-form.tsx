"use client";
import { useActionState,useState } from "react";
import { saveOffer } from "@/app/admin/offer-actions";
export type OfferRecord={id:string;title:string;message:string;discount_kind:string;discount_value:number;starts_at:string;ends_at:string;scope:string;product_ids:string[];category_ids:string[];is_active:boolean;version:number;code?:string};
type Choice={id:string;name:string};
export function OfferForm({offer,store,products,categories}:{offer?:OfferRecord;store:string;products:Choice[];categories:Choice[]}) {
 const [state,action,pending]=useActionState(saveOffer,{});
 const [scope,setScope]=useState(offer?.scope??"STORE");
 const [kind,setKind]=useState(offer?.discount_kind??"PERCENT");
 return <form action={action} className="admin-live-form"><fieldset disabled={pending}><input type="hidden" name="id" value={offer?.id??""}/><input type="hidden" name="version" value={offer?.version??""}/><input type="hidden" name="store" value={store}/>
 <label>Offer title<input name="title" required maxLength={160} defaultValue={offer?.title}/></label><label>Coupon code<input name="code" required minLength={3} maxLength={20} pattern="[A-Za-z0-9]{3,20}" autoCapitalize="characters" style={{textTransform:"uppercase"}} defaultValue={offer?.code}/><span>3–20 letters or numbers, e.g. SAVE10. Customers enter or pick this code in the cart.</span></label><label>Message<textarea name="message" maxLength={1000} defaultValue={offer?.message}/></label>
 <label>Discount type<select name="kind" value={kind} onChange={e=>setKind(e.target.value)}><option value="PERCENT">Percentage</option><option value="FIXED">Fixed amount (₹)</option></select></label>
 <label>{kind==="PERCENT"?"Discount (%)":"Discount (₹)"}<input name="amount" type="number" min="0.01" max={kind==="PERCENT"?100:1000000} step="0.01" required defaultValue={offer?offer.discount_value/100:undefined}/></label>
 <p>Dates are India time (IST). The end time is exclusive.</p>
 <label>Starts (IST)<input name="start" type="datetime-local" required defaultValue={offer?new Date(new Date(offer.starts_at).getTime()+330*60000).toISOString().slice(0,16):undefined}/></label>
 <label>Ends (IST)<input name="end" type="datetime-local" required defaultValue={offer?new Date(new Date(offer.ends_at).getTime()+330*60000).toISOString().slice(0,16):undefined}/></label>
 <label>Applies to<select name="scope" value={scope} onChange={e=>setScope(e.target.value)}><option value="STORE">Whole store</option><option value="PRODUCTS">Selected products</option><option value="CATEGORIES">Selected categories (including subcategories)</option></select></label>
 {scope!=="STORE"&&<label>{scope==="PRODUCTS"?"Products":"Categories"}<select key={scope} name={scope==="PRODUCTS"?"products":"categories"} multiple required defaultValue={scope==="PRODUCTS"?offer?.product_ids:offer?.category_ids}>{(scope==="PRODUCTS"?products:categories).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select><span>Choose one or more. Use Ctrl/Command to select multiple options.</span></label>}
 <label>Status<select name="active" defaultValue={String(offer?.is_active??false)}><option value="false">Inactive</option><option value="true">Active during scheduled dates</option></select></label>
 <p>A discount applies only when the customer applies this code. One coupon per order; discounts exclude delivery and are rounded to whole rupees.</p><button className="admin-button">{pending?"Saving…":"Save offer"}</button></fieldset>{state.error&&<p role="alert">{state.error}</p>}{state.success&&<p role="status">{state.success}</p>}</form>;
}
