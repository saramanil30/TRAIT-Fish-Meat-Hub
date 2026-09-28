"use client";
import Link from "next/link";
export default function StaffError({retry}:{retry:()=>void}) {
 return <main className="trait-admin admin-live"><h1>Workspace unavailable</h1><p role="alert">We could not load this workspace. Try again or sign in to check your access.</p><button className="admin-button" onClick={()=>retry()}>Try again</button><Link href="/admin">Staff sign in</Link></main>;
}
