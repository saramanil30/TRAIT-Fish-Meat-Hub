"use server";
import { revalidatePath } from "next/cache";
import { requireStaff, staffRpc, uploadCategoryImage, uploadShareImage, validProductWebp } from "@/lib/admin/server";
import { rupeesToPaise } from "@/lib/admin/permissions";
import { maxSpecials, specialBadges, validSocialUrl, type SpecialBadge } from "@/lib/homepage-content";
import { validShareJpeg } from "@/lib/share-image";
import { linkPreviewLimits } from "@/lib/link-preview";
import { homepageTextFields, homepageTextPattern, type HomepageText } from "@/lib/homepage-text";
import type { ActionState } from "./actions";
export type HomepageTextState = ActionState & { version?: number };
/** ADMIN/OWNER only (api.save_homepage_text checks again and writes the audit entry). Blank fields are left out, so the homepage uses its built-in text. */
export async function saveHomepageText(_: HomepageTextState, form: FormData): Promise<HomepageTextState> {
 try {
  const {token,context}=await requireStaff("settings");
  if(context.role!=="ADMIN"&&context.role!=="OWNER") return {error:"Only OWNER and ADMIN can edit homepage text."};
  const store=String(form.get("store")??"");
  if(!context.stores.some(s=>s.id===store)) return {error:"Choose one of your stores."};
  const content:HomepageText={};
  for(const f of homepageTextFields){
   const value=String(form.get(f.key)??"").replace(/\s+/g," ").trim();
   if(!value) continue;
   if(value.length>f.max) return {error:`${f.label} must be ${f.max} characters or fewer.`};
   if(homepageTextPattern.test(value)) return {error:`${f.label} must be plain text (no < or >).`};
   content[f.key]=value;
  }
  const version=await staffRpc<number>(token,"save_homepage_text",{target_store:store,expected_version:Number(form.get("version"))||0,content});
  revalidatePath("/");revalidatePath("/admin","layout");
  return {success:"Homepage text saved. Blank fields show the built-in text.",version};
 } catch (cause) {
  return {error:cause instanceof Error&&cause.message.includes("changed")?"Someone else saved homepage text since you opened this page. Reload and try again.":"Unable to save homepage text. Check the fields and your access."};
 }
}
/** Link preview: ADMIN/OWNER only (api.save_link_preview checks again and audits). Blank text uses the built-in preview; the image is checked here, before upload. */
export async function saveLinkPreview(_: HomepageTextState, form: FormData): Promise<HomepageTextState> {
 try {
  const {token,context}=await requireStaff("settings");
  if(context.role!=="ADMIN"&&context.role!=="OWNER") return {error:"Only OWNER and ADMIN can edit the link preview."};
  const store=String(form.get("store")??"");
  if(!context.stores.some(s=>s.id===store)) return {error:"Choose one of your stores."};
  const fields={title:"Share title",description:"Share description"} as const;
  const values:Record<keyof typeof fields,string|null>={title:null,description:null};
  for(const key of ["title","description"] as const){
   const value=String(form.get(key)??"").replace(/\s+/g," ").trim();
   if(value.length>linkPreviewLimits[key]) return {error:`${fields[key]} must be ${linkPreviewLimits[key]} characters or fewer.`};
   if(homepageTextPattern.test(value)) return {error:`${fields[key]} must be plain text (no < or >).`};
   values[key]=value||null;
  }
  // A new upload replaces the current image; "Remove" clears it; otherwise the current one stays.
  const current=String(form.get("image")??"");
  let image:string|null=form.get("removeImage")==="true"||!/^[0-9a-f-]{36}\/[0-9a-f]{64}\.jpg$/.test(current)?null:current;
  const file=form.get("imageFile");
  if(file instanceof File&&file.size>0){
   const bytes=new Uint8Array(await file.arrayBuffer());
   if(!validShareJpeg(bytes)) return {error:"The share image must be a JPG of exactly 1200×630 pixels and at most 300 KB."};
   try{image=await uploadShareImage(token,context.businessId,bytes);}
   catch{return {error:"The share image could not be uploaded, so nothing was saved. Check the share image storage setup and try again."};}
  }
  const version=await staffRpc<number>(token,"save_link_preview",{target_store:store,expected_version:Number(form.get("version"))||0,share_title:values.title,share_description:values.description,image});
  revalidatePath("/","layout");
  return {success:"Link preview saved. Apps that already cached your link may take a while to show the new preview.",version};
 } catch (cause) {
  return {error:cause instanceof Error&&cause.message.includes("changed")?"Someone else saved the link preview since you opened this page. Reload and try again.":"Unable to save the link preview. Check the fields and your access."};
 }
}
/** ADMIN/OWNER and one of their stores; the database checks both again. */
async function homepageEditor(form: FormData, what: string) {
 const {token,context}=await requireStaff("settings");
 if(context.role!=="ADMIN"&&context.role!=="OWNER") throw new Error("Only OWNER and ADMIN can edit "+what+".");
 const store=String(form.get("store")??"");
 if(!context.stores.some(s=>s.id===store)) throw new Error("Choose one of your stores.");
 return {token,context,store};
}
const failure=(cause:unknown,what:string)=>({error:cause instanceof Error&&/^(Only OWNER|Choose one)/.test(cause.message)?cause.message
 :cause instanceof Error&&cause.message.includes("changed")?"Someone else saved "+what+" since you opened this page. Reload and try again.":"Unable to save "+what+". Check the fields and your access."});
/** Instagram / Facebook links; blank removes the icon from the header. */
export async function saveHomepageLinks(_: HomepageTextState, form: FormData): Promise<HomepageTextState> {
 try {
  const {token,store}=await homepageEditor(form,"social links");
  const links={instagram:null as string|null,facebook:null as string|null};
  for(const network of ["instagram","facebook"] as const){
   const value=String(form.get(network)??"").trim();
   if(value&&!validSocialUrl(value,network)) return {error:network==="instagram"?"Enter an Instagram link starting with https://www.instagram.com/":"Enter a Facebook link starting with https://www.facebook.com/"};
   links[network]=value||null;
  }
  const version=await staffRpc<number>(token,"save_homepage_links",{target_store:store,expected_version:Number(form.get("version"))||0,instagram:links.instagram,facebook:links.facebook});
  revalidatePath("/","layout");
  return {success:"Social links saved. Icons show in the top bar only for links that are set.",version};
 } catch (cause) { return failure(cause,"social links"); }
}
/** Today's Specials: the whole list, in order. Each row: product, optional badge, optional "Was ₹" price. */
export async function saveHomepageSpecials(_: HomepageTextState, form: FormData): Promise<HomepageTextState> {
 try {
  const {token,store}=await homepageEditor(form,"Today's Specials");
  const products=form.getAll("product").map(String),badges=form.getAll("badge").map(String),was=form.getAll("was").map(String);
  if(products.length>maxSpecials) return {error:"Choose at most "+maxSpecials+" specials."};
  if(new Set(products).size!==products.length) return {error:"Each product can appear only once."};
  const specials=[];
  for(const [n,product] of products.entries()){
   if(!/^[0-9a-f-]{36}$/.test(product)) return {error:"Choose a product for every row."};
   const badge=badges[n]??"";
   if(badge&&!(badge in specialBadges)) return {error:"Choose a badge from the list."};
   let wasPaise:number|null=null;
   if(was[n]?.trim()){
    try{wasPaise=rupeesToPaise(was[n]);}catch{return {error:"Enter the \"Was ₹\" price in rupees, e.g. 2400."};}
    if(wasPaise<1||wasPaise>100000000) return {error:"The \"Was ₹\" price must be between ₹0.01 and ₹1,000,000."};
   }
   specials.push({product,badge:(badge||null) as SpecialBadge|null,wasPaise});
  }
  const version=await staffRpc<number>(token,"save_homepage_specials",{target_store:store,expected_version:Number(form.get("version"))||0,specials});
  revalidatePath("/");
  return {success:"Today's Specials saved.",version};
 } catch (cause) { return failure(cause,"Today's Specials"); }
}
/** Category circle photo: upload (already WebP from the browser) or remove. */
export async function saveCategoryPhoto(_: HomepageTextState, form: FormData): Promise<HomepageTextState> {
 try {
  const {token,context}=await requireStaff("settings");
  if(context.role!=="ADMIN"&&context.role!=="OWNER") return {error:"Only OWNER and ADMIN can change category photos."};
  const category=String(form.get("category")??"");
  if(!/^[0-9a-f-]{36}$/.test(category)) return {error:"Choose a category."};
  let path:string|null=null;
  if(form.get("remove")!=="true"){
   const file=form.get("photo");
   if(!(file instanceof File)||!file.size) return {error:"Choose a photo to upload."};
   const bytes=new Uint8Array(await file.arrayBuffer());
   if(!validProductWebp(bytes)) return {error:"Upload a JPEG, PNG or WebP photo under 1 MB after conversion."};
   try{path=await uploadCategoryImage(token,context.businessId,category,bytes);}
   catch{return {error:"The photo could not be uploaded, so nothing was saved. Check the category image storage setup and try again."};}
  }
  const version=await staffRpc<number>(token,"save_category_photo",{category,expected_version:Number(form.get("version"))||0,object_path:path});
  revalidatePath("/","layout");
  return {success:path?"Category photo saved.":"Category photo removed; the built-in image shows again.",version};
 } catch (cause) { return failure(cause,"the category photo"); }
}
