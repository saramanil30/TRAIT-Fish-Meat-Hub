"use client";
import { useActionState, useState } from "react";
import { saveHomepageText, type HomepageTextState } from "@/app/admin/homepage-actions";
import { HeroBody } from "@/components/home/hero-body";
import { homepageTextFields, type HomepageText } from "@/lib/homepage-text";
/** Settings → Homepage text: plain-text hero fields with a live preview. Blank fields keep the built-in text (shown as the placeholder). */
export function HomepageTextForm({store,content,version}:{store:string;content:HomepageText;version:number}) {
 const [state,action,pending]=useActionState<HomepageTextState,FormData>(saveHomepageText,{});
 const [draft,setDraft]=useState<HomepageText>(content);
 return <section className="homepage-text-settings"><h2>Homepage text</h2><p className="admin-muted">The welcome section at the top of the homepage for this store. Plain text only; leave a field blank to use the text shown in grey.</p>
  <form action={action} className="admin-live-form"><input type="hidden" name="store" value={store}/><input type="hidden" name="version" value={state.version??version}/><fieldset disabled={pending}>
   {homepageTextFields.map(f=>{const value=draft[f.key]??"";return <label key={f.key}>{f.label}{f.key==="subtitle"
    ?<textarea name={f.key} maxLength={f.max} rows={3} placeholder={f.fallback} value={value} onChange={e=>setDraft({...draft,[f.key]:e.target.value.replace(/[<>]/g,"")})}/>
    :<input name={f.key} maxLength={f.max} placeholder={f.fallback} value={value} onChange={e=>setDraft({...draft,[f.key]:e.target.value.replace(/[<>]/g,"")})}/>}
    <small className="admin-muted">{value.length}/{f.max}</small></label>;})}
   <button className="admin-button">{pending?"Saving…":"Save homepage text"}</button></fieldset>
   {state.error&&<p role="alert">{state.error}</p>}{state.success&&<p role="status">{state.success}</p>}</form>
  <h3>Live preview</h3><div className="hero hero-preview" aria-label="Homepage preview" role="img"><HeroBody saved={draft} preview/></div></section>;
}
