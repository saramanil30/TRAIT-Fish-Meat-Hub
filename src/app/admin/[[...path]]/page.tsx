import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { LiveWorkspace } from "@/components/admin/live-workspace";
import { StaffRecovery } from "@/components/admin/recovery";
import { StaffLogin } from "@/components/admin/live-forms";
import { requireStaff, staffConfigured } from "@/lib/admin/server";
import { canAccessSection, staffSections, type StaffSection } from "@/lib/admin/permissions";
import "@/components/admin/admin.css";
export const metadata: Metadata = { title: "Staff workspace", robots: { index: false, follow: false } };
export default async function AdminPage({ params,searchParams }: { params: Promise<{ path?: string[] }>;searchParams:Promise<{store?:string;order?:string;days?:string;before?:string;cursor?:string;from?:string;until?:string}> }) {
 const {path=[]}=await params;
 if(path.length===1&&path[0]==="recovery") return <StaffRecovery/>;
 if (!path.length || (path.length===1&&path[0]==="login")) {
  const configured=staffConfigured();
  return <div className="trait-admin admin-login"><section className="admin-login-story"><Link href="/" className="admin-wordmark">TRAIT<span>FISH &amp; MEAT HUB</span></Link><div><p className="admin-kicker">THE STORE BEHIND THE FRESHNESS</p><h1>Fresh thinking.<br/>Smooth operations.</h1><p>Your daily orders, your team, your business.</p></div><small>TRAIT STAFF WORKSPACE</small></section><section className="admin-login-form"><div><h2>Staff sign in</h2><p>Common login for ADMIN, OWNER and EMPLOYEE. Your active membership determines access.</p><StaffLogin configured={configured}/>{!configured&&<div className="admin-notice"><strong>Secure sign-in is not configured yet.</strong><p>Staff authentication and request protection must be configured before sign-in. Credentials are not collected while sign-in is disabled.</p></div>}<Link className="admin-back" href="/">Back to storefront</Link></div></section></div>;
 }
 if(path[0]==="preview") notFound();
 let staff;
 try {staff=await requireStaff();} catch {redirect("/admin/login");}
 if(path.length!==2||!staffSections.includes(path[1] as StaffSection)) redirect("/admin/"+staff.context.role.toLowerCase()+"/dashboard");
 const section=path[1] as StaffSection;
 if(path[0]!==staff.context.role.toLowerCase()||!canAccessSection(staff.context.role,section)) notFound();
 return <LiveWorkspace context={staff.context} token={staff.token} section={section} storeId={(await searchParams).store} orderId={(await searchParams).order} days={Number((await searchParams).days??30)} before={(await searchParams).before} cursor={(await searchParams).cursor} fromDate={(await searchParams).from} untilDate={(await searchParams).until}/>;
}
