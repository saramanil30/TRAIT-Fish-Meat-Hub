import { cookies } from "next/headers";
import { StaffSession } from "@/components/admin/session";
import { ForgotPassword } from "@/components/admin/forgot-password";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { LiveWorkspace } from "@/components/admin/live-workspace";
import { StaffRecovery } from "@/components/admin/recovery";
import { StaffLogin } from "@/components/admin/live-forms";
import { requireStaff, refreshCookie } from "@/lib/admin/server";
import { canAccessSection, staffSections, type StaffSection } from "@/lib/admin/permissions";
import "@/components/admin/admin.css";
export const metadata: Metadata = { title: "Staff workspace", robots: { index: false, follow: false } };
export default async function AdminPage({ params,searchParams }: { params: Promise<{ path?: string[] }>;searchParams:Promise<{store?:string;order?:string;before?:string;cursor?:string;from?:string;until?:string;period?:string;status?:string;range?:string;tab?:string}> }) {
 const {path=[]}=await params;
 if(path.length===1&&path[0]==="recovery") return <StaffRecovery/>;
 if(path.length===1&&path[0]==="forgot-password") return <ForgotPassword/>;
 if (!path.length || (path.length===1&&path[0]==="login")) {
  let destination="";
  try {const staff=await requireStaff();destination="/admin/"+staff.context.role.toLowerCase()+"/dashboard";} catch { /* Show the common login form. */ }
  if(destination)redirect(destination);
  const resume=!!(await cookies()).get(refreshCookie)?.value;
  return <div className="trait-admin admin-login"><section className="admin-login-story"><Link href="/" className="admin-wordmark">TRAIT<span>FISH &amp; MEAT HUB</span></Link><div><p className="admin-kicker">THE STORE BEHIND THE FRESHNESS</p><h1>Fresh thinking.<br/>Smooth operations.</h1><p>Your daily orders, your team, your business.</p></div><small>TRAIT STAFF WORKSPACE</small></section><section className="admin-login-form"><div><h2>Staff sign in</h2><StaffLogin/>{resume&&<StaffSession resume/>}<nav className="admin-login-links" aria-label="Sign-in help"><Link className="admin-back" href="/admin/forgot-password">Forgot password?</Link><Link className="admin-back" href="/">Back to storefront</Link></nav></div></section></div>;
 }
 if(path[0]==="preview") notFound();
 let staff;
 try {staff=await requireStaff();} catch {redirect("/admin/login");}
 if(path.length!==2||!staffSections.includes(path[1] as StaffSection)) redirect("/admin/"+staff.context.role.toLowerCase()+"/dashboard");
 const section=path[1] as StaffSection;
 const query=await searchParams;
 if(path[0]!==staff.context.role.toLowerCase()||!canAccessSection(staff.context.role,section)) notFound();
 return <LiveWorkspace context={staff.context} token={staff.token} section={section} storeId={query.store} orderId={query.order} before={query.before} cursor={query.cursor} fromDate={query.from} untilDate={query.until} period={query.period} status={query.status} range={query.range} tab={query.tab}/>;
}
