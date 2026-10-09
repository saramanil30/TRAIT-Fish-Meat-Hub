"use server";
import { revalidatePath } from "next/cache";
import { requireStaff, staffRpc } from "@/lib/admin/server";
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
