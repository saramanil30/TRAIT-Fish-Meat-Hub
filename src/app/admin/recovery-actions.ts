"use server";
import { authRequest,resolveStaff,recoveryRedirect } from "@/lib/admin/server";
import type { ActionState } from "./actions";
export async function resetStaffPassword(token:string,password:string){
 try {
  // Supabase Auth applies its own recovery and user-update rate limits.
  if(typeof token!=="string"||token.length>10000||typeof password!=="string"||password.length<12||password.length>1024)throw new Error("Invalid reset");
  await resolveStaff(token);
  const response=await authRequest("user",{method:"PUT",headers:{Authorization:"Bearer "+token},body:JSON.stringify({password})});
  if(!response.ok)throw new Error("Reset rejected");
  await authRequest("logout",{method:"POST",headers:{Authorization:"Bearer "+token}});
  return {success:true};
 }catch{return {error:"Unable to set the password. Use a fresh invitation/recovery link and check active staff access."};}
}

export async function requestStaffRecovery(_:ActionState,form:FormData):Promise<ActionState>{
 const email=String(form.get("email")??"").trim();
 if(email.length>254||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return {error:"Enter a valid email address."};
 try {
  const redirect=recoveryRedirect();
  const response=await authRequest("recover?redirect_to="+encodeURIComponent(redirect),{method:"POST",body:JSON.stringify({email})});
  if(response.status===429)return {error:"Please wait before requesting another reset email."};
  if(!response.ok)throw new Error("Recovery unavailable.");
  return {success:"If this email has an account, a password reset link will be sent. Check your inbox and spam folder."};
 }catch{return {error:"Password reset is temporarily unavailable. Contact your store manager."};}
}
