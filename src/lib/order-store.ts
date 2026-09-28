"use client";
import { useSyncExternalStore } from "react";
import { EMPTY_CHECKOUT } from "@/lib/order";
import type { CheckoutDetails } from "@/types/order";
const initial:{ready:boolean;draft:CheckoutDetails;pending:string|null}={ready:false,draft:EMPTY_CHECKOUT,pending:null};
let state=initial;
const listeners=new Set<()=>void>();
function emit(){listeners.forEach(fn=>fn());}
function hydrate(){if(state.ready||typeof window==="undefined")return;let pending=null;try{pending=sessionStorage.getItem("trait.pending-checkout");}catch{}state={...state,ready:true,pending};}
function subscribe(fn:()=>void){listeners.add(fn);hydrate();emit();return()=>{listeners.delete(fn);};}
export function useOrderState(){return useSyncExternalStore(subscribe,()=>state,()=>initial);}
export function saveCheckoutDraft(draft:CheckoutDetails){hydrate();state={...state,draft};emit();}
export function savePendingCheckout(pending:string|null){hydrate();state={...state,pending};try{if(pending)sessionStorage.setItem("trait.pending-checkout",pending);else sessionStorage.removeItem("trait.pending-checkout");}catch{}emit();}
