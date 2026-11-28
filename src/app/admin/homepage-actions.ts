"use server";
import { revalidatePath } from "next/cache";
import { requireStaff, staffRpc, uploadBrandImage, uploadCategoryImage, uploadHeroImage, uploadShareImage, validProductWebp } from "@/lib/admin/server";
import { validDesktopLogo, validIconPng, validMobileLogo } from "@/lib/brand-image";
import { maxHeroSlides, validHeroWebp } from "@/lib/hero-image";
import { rupeesToPaise } from "@/lib/admin/permissions";
import { maxSpecials, specialBadges, validSocialUrl, type SpecialBadge } from "@/lib/homepage-content";
import { validShareJpeg, validSquareShareJpeg } from "@/lib/share-image";
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
  // Compact (default): a square JPG, normally made from the header icon; both images are kept so switching style loses neither.
  const style=form.get("style")==="LARGE"?"LARGE":"COMPACT";
  const currentSquare=String(form.get("squareImage")??""),currentSide=Number(form.get("squareSize"));
  let square:{path:string;side:number}|null=/^[0-9a-f-]{36}\/[0-9a-f]{64}\.jpg$/.test(currentSquare)&&Number.isInteger(currentSide)?{path:currentSquare,side:currentSide}:null;
  const squareFile=form.get("squareFile");
  if(squareFile instanceof File&&squareFile.size>0){
   const bytes=new Uint8Array(await squareFile.arrayBuffer()),side=validSquareShareJpeg(bytes);
   if(!side) return {error:"The compact image must be a square JPG of 400–1200 pixels and at most 300 KB."};
   try{square={path:await uploadShareImage(token,context.businessId,bytes),side};}
   catch{return {error:"The compact image could not be uploaded, so nothing was saved. Check the share image storage setup and try again."};}
  }
  const version=await staffRpc<number>(token,"save_link_preview",{target_store:store,expected_version:Number(form.get("version"))||0,share_title:values.title,share_description:values.description,image,
   preview_style:style,square_image:square?.path??null,square_size:square?.side??null});
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
/** Homepage banner slides: add (WebP, >= 1600 px wide, <= 1 MB, checked here from the file header and again in the
 *  database), reorder (the full list), or remove (soft: hidden from the homepage, file kept). ADMIN/OWNER, own store. */
export async function manageHeroSlides(_: ActionState, form: FormData): Promise<ActionState> {
 const operation=String(form.get("operation")??"");
 try {
  const {token,context,store}=await homepageEditor(form,"the homepage banner");
  const slideId=(value:string)=>{if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))throw new Error("Invalid record.");return value;};
  if(operation==="add"){
   const file=form.get("photo");
   if(!(file instanceof File)||!file.size) return {error:"Choose a photo to upload."};
   const bytes=new Uint8Array(await file.arrayBuffer());
   if(!validHeroWebp(bytes)) return {error:"The banner photo must be a WebP image at least 1600 pixels wide and at most 1 MB."};
   const alt=String(form.get("alt")??"").replace(/\s+/g," ").trim();
   if(alt.length>160||/[<>]/.test(alt)) return {error:"The description must be plain text of at most 160 characters."};
   await uploadHeroImage(token,context.businessId,store,alt,bytes);
  } else if(operation==="arrange"){
   const slides=String(form.get("slides")??"").split(",").map(slideId);
   if(!slides.length||slides.length>maxHeroSlides) throw new Error("Invalid record.");
   await staffRpc(token,"arrange_hero_slides",{target_store:store,slides});
  } else if(operation==="remove"){
   await staffRpc(token,"remove_hero_slide",{target_store:store,slide:slideId(String(form.get("slide")??""))});
  } else return {error:"Unknown action."};
  revalidatePath("/");revalidatePath("/admin","layout");
  return {success:operation==="add"?"Slide added to the homepage banner.":operation==="remove"?"Slide removed from the homepage banner.":"Slide order saved."};
 } catch (cause) {
  if(cause instanceof Error&&/^(The banner photo|The homepage banner can|This photo is already|Photo upload is not)/.test(cause.message)) return {error:cause.message};
  return failure(cause,"the homepage banner");
 }
}
type BrandingSettings={desktopLogo:string|null;desktopWidth:number|null;desktopHeight:number|null;mobileLogo:string|null;mobileSize:number|null;favicon:string|null;touchIcon:string|null;version:number};
/** Header logo: upload or remove the wide desktop logo, or the square mobile logo with its generated 32×32 favicon and
 *  180×180 home-screen icon. ADMIN/OWNER, own store; every file is checked here from its header before upload and the
 *  database checks paths, stored type and size again (api.save_store_branding, audited). The other logo is kept as saved. */
export async function saveStoreBranding(_: HomepageTextState, form: FormData): Promise<HomepageTextState> {
 const part=String(form.get("part")??""),remove=form.get("remove")==="true";
 if(part!=="desktop"&&part!=="mobile") return {error:"Unknown action."};
 try {
  const {token,context,store}=await homepageEditor(form,"the header logo");
  const current=await staffRpc<BrandingSettings>(token,"store_branding_settings",{target_store:store});
  if(Number(form.get("version"))!==Number(current.version??0)) return {error:"Someone else saved the header logo since you opened this page. Reload and try again."};
  const next={desktop_logo:current.desktopLogo,desktop_width:current.desktopWidth,desktop_height:current.desktopHeight,
   mobile_logo:current.mobileLogo,mobile_size:current.mobileSize,favicon:current.favicon,touch_icon:current.touchIcon};
  const bytesOf=async(name:string)=>{const file=form.get(name);return file instanceof File&&file.size?new Uint8Array(await file.arrayBuffer()):null;};
  const upload=async(bytes:Uint8Array,type:"png"|"webp")=>{try{return await uploadBrandImage(token,context.businessId,store,bytes,type);}catch{throw new Error("Upload failed");}};
  try{
   if(part==="desktop"){
    if(remove){next.desktop_logo=null;next.desktop_width=null;next.desktop_height=null;}
    else{
     const bytes=await bytesOf("logo");if(!bytes) return {error:"Choose a logo to upload."};
     const image=validDesktopLogo(bytes);
     if(!image) return {error:"The desktop logo must be a PNG or WebP, 40–600 pixels tall, at least 1.5× as wide as tall, at most 2400 pixels wide and 512 KB."};
     next.desktop_logo=await upload(bytes,image.type);next.desktop_width=image.width;next.desktop_height=image.height;
    }
   } else if(remove){next.mobile_logo=null;next.mobile_size=null;next.favicon=null;next.touch_icon=null;}
   else{
    const [logo,favicon,touch]=await Promise.all([bytesOf("logo"),bytesOf("favicon"),bytesOf("touchIcon")]);
    if(!logo) return {error:"Choose a logo to upload."};
    const image=validMobileLogo(logo);
    if(!image) return {error:"The mobile logo must be a square PNG or WebP, 192–1024 pixels and at most 512 KB."};
    if(!favicon||!touch||!validIconPng(favicon,32)||!validIconPng(touch,180)) return {error:"The favicon could not be generated from this logo. Try a different file."};
    next.mobile_logo=await upload(logo,image.type);next.mobile_size=image.width;next.favicon=await upload(favicon,"png");next.touch_icon=await upload(touch,"png");
   }
  }catch(cause){if(cause instanceof Error&&cause.message==="Upload failed") return {error:"The logo could not be uploaded, so nothing was saved. Check the brand image storage setup and try again."};throw cause;}
  const version=await staffRpc<number>(token,"save_store_branding",{target_store:store,expected_version:Number(current.version??0),...next});
  revalidatePath("/","layout");
  return {success:remove?"Logo removed; the built-in logo shows again.":part==="desktop"?"Desktop logo saved.":"Mobile logo and favicon saved. Browsers may keep the old tab icon until the page is reloaded.",version};
 } catch (cause) { return failure(cause,"the header logo"); }
}
