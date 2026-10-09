import { headers } from "next/headers";
import { staffRpc } from "@/lib/admin/server";
import type { HomepageText } from "@/lib/homepage-text";
import { shareImageUrl, type LinkPreview } from "@/lib/link-preview";
import { HomepageTextForm } from "./homepage-text";
import { LinkPreviewForm, ShareToWhatsApp } from "./link-preview";
/** Settings for ADMIN and OWNER: homepage hero text, link preview and the WhatsApp share sheet. */
export async function HomepageTextSettings({token,store}:{token:string;store?:string}){
 if(!store)return null;
 const [text,preview]=await Promise.all([
  staffRpc<{content:HomepageText;version:number}>(token,"homepage_text_settings",{target_store:store}).catch(()=>null),
  staffRpc<LinkPreview>(token,"link_preview_settings",{target_store:store}).catch(()=>null)]);
 // The customer site address shared in links; the request's own host when NEXT_PUBLIC_SITE_URL is unset.
 const host=(await headers()).get("host");
 const site=process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/,"")||(host?(/^(localhost|127\.)/.test(host)?"http://":"https://")+host:"");
 const missing=<p>Unavailable. Apply the homepage and link preview database migration, then reload.</p>;
 return <>
  {text?<HomepageTextForm key={store+":"+text.version} store={store} content={text.content??{}} version={Number(text.version)}/>:<section><h2>Homepage text</h2>{missing}</section>}
  {preview?<LinkPreviewForm key={store+":"+preview.version} store={store} title={preview.title??undefined} description={preview.description??undefined} imagePath={preview.imagePath??undefined}
   imageUrl={preview.imagePath?shareImageUrl(preview.imagePath,preview.version):null} version={Number(preview.version??0)} site={site}/>:<section><h2>Link preview</h2>{missing}</section>}
  <ShareToWhatsApp site={site} title={preview?.title??undefined}/>
 </>;
}
