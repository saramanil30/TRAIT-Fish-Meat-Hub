"use client";
import Link from "next/link";
import {useState,type FormEvent} from "react";
import {resetStaffPassword} from "@/app/admin/recovery-actions";
export function StaffRecovery(){
 const [error,setError]=useState(""),[pending,setPending]=useState(false),[complete,setComplete]=useState(false);
 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();setError("");const data=new FormData(event.currentTarget);
  const password=String(data.get("password")??"");
  if(password!==data.get("confirm")){setError("Passwords must match.");return;}
  const hash=new URLSearchParams(window.location.hash.slice(1)),token=hash.get("access_token");
  if(!token||!["recovery","invite"].includes(hash.get("type")??"")){setError("Open a valid staff invitation or recovery link.");return;}
  setPending(true);
  const result=await resetStaffPassword(token,password);
  if(result.success){window.history.replaceState(null,"","/admin/recovery");setComplete(true);}else setError(result.error??"Unable to reset.");
  setPending(false);
 }
 return <div className="trait-admin admin-live"><h1>Set your staff password</h1>{complete?<p>Password updated. <Link href="/admin">Sign in</Link></p>:<form onSubmit={submit} className="admin-live-form"><fieldset disabled={pending}><label>New password<input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={1024} required/></label><label>Confirm password<input name="confirm" type="password" autoComplete="new-password" minLength={12} maxLength={1024} required/></label><button className="admin-button">{pending?"Updating...":"Set password"}</button></fieldset></form>}{error&&<p role="alert">{error}</p>}</div>;
}
