"use server";
import { revalidatePath } from "next/cache";
import { requireStaff, staffRpc, uploadShareImage } from "@/lib/admin/server";
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
