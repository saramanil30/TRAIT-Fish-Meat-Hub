import { staffRpc } from "@/lib/admin/server";
import type { HomepageText } from "@/lib/homepage-text";
import { HomepageTextForm } from "./homepage-text";
export async function HomepageTextSettings({token,store}:{token:string;store?:string}){
 if(!store)return null;
 const settings=await staffRpc<{content:HomepageText;version:number}>(token,"homepage_text_settings",{target_store:store}).catch(()=>null);
 if(!settings)return <section><h2>Homepage text</h2><p>Homepage text is unavailable. Apply the homepage text database migration, then reload.</p></section>;
 return <HomepageTextForm key={store+":"+settings.version} store={store} content={settings.content??{}} version={Number(settings.version)}/>;
}
