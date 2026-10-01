"use client";
import Link from "next/link";
import {useActionState} from "react";
import {requestStaffRecovery} from "@/app/admin/recovery-actions";
export function ForgotPassword(){
 const [state,action,pending]=useActionState(requestStaffRecovery,{});
 return <div className="trait-admin admin-login"><section className="admin-login-form"><div><h1>Forgot password?</h1><p>Enter your email to receive a reset link.</p><form action={action}><fieldset disabled={pending}><label>Email<input name="email" type="email" autoComplete="email" maxLength={254} required/></label><button className="admin-button">{pending?"Sending...":"Send reset link"}</button></fieldset>{state.error&&<p role="alert">{state.error}</p>}{state.success&&<p role="status">{state.success}</p>}</form><Link className="admin-back" href="/admin">Back to sign in</Link></div></section></div>;
}
