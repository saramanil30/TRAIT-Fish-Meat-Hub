import { LiveTracking } from "@/components/checkout/live-tracking";
export const dynamic = "force-dynamic";
export const metadata = { title: "Your TRAIT order", robots: {index:false,follow:false}, referrer:"no-referrer" as const };
export default async function Page({params}:{params:Promise<{token:string}>}) { return <LiveTracking token={(await params).token} confirmation/>; }