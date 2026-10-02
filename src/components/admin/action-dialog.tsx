"use client";
import { useRef, type ReactNode } from "react";
/** A small trigger that opens its form in a modal, so rarely used fields stay out of the order list. */
export function ActionDialog({label,title,triggerClassName,children}:{label:string;title:string;triggerClassName:string;children:ReactNode}) {
 const ref=useRef<HTMLDialogElement>(null);
 return <><button type="button" className={triggerClassName} onClick={()=>ref.current?.showModal()}>{label}</button>
  <dialog ref={ref} className="trait-admin admin-dialog ord-dialog" aria-label={title}><div className="admin-panel-heading"><h2>{title}</h2><button type="button" className="admin-icon-button" onClick={()=>ref.current?.close()} aria-label="Close dialog">×</button></div>{children}</dialog></>;
}
