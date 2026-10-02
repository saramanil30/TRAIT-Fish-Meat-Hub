"use client";
import { useActionState, type ReactNode } from "react";
import { operationalAction } from "@/app/admin/operations";
export function OperationalForm({operation,id,version,children,label="Save",className,buttonClassName}:{operation:string;id?:string;version?:number;children?:ReactNode;label?:string;className?:string;buttonClassName?:string}) {
 const [state,action,pending]=useActionState(operationalAction,{});
 return <form action={action} className={className??"admin-live-form"}><input type="hidden" name="operation" value={operation}/><input type="hidden" name="id" value={id??""}/><input type="hidden" name="version" value={version??0}/><fieldset disabled={pending}>{children}<button className={buttonClassName??"admin-button"}>{pending?"Saving…":label}</button></fieldset>{state.error&&<p role="alert">{state.error}</p>}{state.success&&<p role="status">{state.success}</p>}</form>;
}
