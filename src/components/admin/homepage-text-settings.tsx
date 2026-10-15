import { headers } from "next/headers";
import { staffRpc } from "@/lib/admin/server";
import type { HomepageText } from "@/lib/homepage-text";
import { shareImageUrl, type LinkPreview } from "@/lib/link-preview";
import { HomepageTextForm } from "./homepage-text";
import { LinkPreviewForm, ShareToWhatsApp } from "./link-preview";
import { CategoryPhotoForm, SocialLinksForm, SpecialsForm, type CategoryPhotoRecord, type SpecialChoice } from "./homepage-content";
import { categoryPhotoUrl, type SpecialBadge } from "@/lib/homepage-content";
type ContentSettings={instagram:string|null;facebook:string|null;linksVersion:number;specialsVersion:number;
 specials:{productId:string;badge:SpecialBadge|null;wasPaise:number|null}[];categories:CategoryPhotoRecord[]};
/** Settings for ADMIN and OWNER: homepage hero text, social links, Today's Specials, category photos, link preview and the WhatsApp share sheet. */
export async function HomepageTextSettings({token,store}:{token:string;store?:string}){
 if(!store)return null;
 const [text,preview,content,products]=await Promise.all([
  staffRpc<{content:HomepageText;version:number}>(token,"homepage_text_settings",{target_store:store}).catch(()=>null),
  staffRpc<LinkPreview>(token,"link_preview_settings",{target_store:store}).catch(()=>null),
  staffRpc<ContentSettings>(token,"homepage_content_settings",{target_store:store}).catch(()=>null),
  staffRpc<{id:string;name:string;is_active:boolean}[]>(token,"product_content").catch(()=>[])]);
 const choices:SpecialChoice[]=products.map(p=>({id:p.id,name:p.name,active:p.is_active}));
 // The customer site address shared in links; the request's own host when NEXT_PUBLIC_SITE_URL is unset.
 const host=(await headers()).get("host");
 const site=process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/,"")||(host?(/^(localhost|127\.)/.test(host)?"http://":"https://")+host:"");
 const missing=<p>Unavailable. Apply the homepage and link preview database migration, then reload.</p>;
 const missingContent=<p>Unavailable. Apply the homepage storefront database migration (20261018000000_homepage_storefront.sql), then reload.</p>;
 return <>
  {text?<HomepageTextForm key={store+":"+text.version} store={store} content={text.content??{}} version={Number(text.version)}/>:<section><h2>Homepage text</h2>{missing}</section>}
  {content?<>
   <SocialLinksForm key={store+":links:"+content.linksVersion} store={store} instagram={content.instagram??undefined} facebook={content.facebook??undefined} version={Number(content.linksVersion)}/>
   <SpecialsForm key={store+":specials:"+content.specialsVersion} store={store} version={Number(content.specialsVersion)} saved={content.specials} products={choices}/>
   <section><h2>Shop by Category photos</h2><p className="admin-muted">The round photos under &quot;Shop by Category&quot; on the homepage. Categories without a photo use the built-in image. Photos are shared by all your stores.</p>
    <div className="admin-category-photos">{content.categories.map(c=><CategoryPhotoForm key={c.id+":"+c.version} category={c} imageUrl={c.photo?categoryPhotoUrl(process.env.SUPABASE_URL,c.photo):null}/>)}</div>
    {!content.categories.length&&<p>No categories yet.</p>}</section>
  </>:<section><h2>Social links, Today&apos;s Specials and category photos</h2>{missingContent}</section>}
  {preview?<LinkPreviewForm key={store+":"+preview.version} store={store} title={preview.title??undefined} description={preview.description??undefined} imagePath={preview.imagePath??undefined}
   imageUrl={preview.imagePath?shareImageUrl(preview.imagePath,preview.version):null} version={Number(preview.version??0)} site={site}/>:<section><h2>Link preview</h2>{missing}</section>}
  <ShareToWhatsApp site={site} title={preview?.title??undefined}/>
 </>;
}
