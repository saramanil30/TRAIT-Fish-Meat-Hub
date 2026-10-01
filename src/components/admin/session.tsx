"use client";
import { useEffect } from "react";
import { refreshStaffSession } from "@/app/admin/actions";
export function StaffSession({resume=false}:{resume?:boolean}) {
 useEffect(()=>{
  let pending=false,disposed=false;
  const renew=async()=>{
   if(pending||document.visibilityState==="hidden")return;
   pending=true;
   try {const result=await refreshStaffSession(resume);if(result?.error&&!resume&&!disposed)window.location.assign("/admin/login");}
   finally{pending=false;}
  };
  if(resume)void renew();
  const timer=window.setInterval(()=>void renew(),5*60*1000);
  const focus=()=>void renew();window.addEventListener("focus",focus);
  return()=>{disposed=true;window.clearInterval(timer);window.removeEventListener("focus",focus);};
 },[resume]);
 return null;
}
