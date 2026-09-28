"use server";
import { authRequest,resolveStaff } from "@/lib/admin/server";
import { rateLimit } from "@/lib/checkout-server";
export async function resetStaffPassword(token:string,password:string){
 try {
  await rateLimit("password-reset",5);
  if(typeof token!=="string"||token.length>10000||typeof password!=="string"||password.length<12||password.length>1024)throw new Error("Invalid reset");
  await resolveStaff(token);
  const response=await authRequest("user",{method:"PUT",headers:{Authorization:"Bearer "+token},body:JSON.stringify({password})});
  if(!response.ok)throw new Error("Reset rejected");
  await authRequest("logout",{method:"POST",headers:{Authorization:"Bearer "+token}});
  return {success:true};
 }catch{return {error:"Unable to set the password. Use a fresh invitation/recovery link and check active staff access."};}
}
