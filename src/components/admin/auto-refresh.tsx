"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
/** Re-renders the server page every `seconds` while the tab is visible, and once when it becomes visible again. */
export function AutoRefresh({seconds=60}:{seconds?:number}) {
 const router=useRouter();
 useEffect(()=>{
  let last=Date.now();
  const tick=()=>{if(document.visibilityState==="visible"&&Date.now()-last>=seconds*1000-500){last=Date.now();router.refresh();}};
  const timer=window.setInterval(tick,seconds*1000);
  document.addEventListener("visibilitychange",tick);
  return()=>{window.clearInterval(timer);document.removeEventListener("visibilitychange",tick);};
 },[router,seconds]);
 return null;
}
