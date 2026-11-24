import { LiveTracking } from "@/components/checkout/live-tracking";
export const dynamic = "force-dynamic";
export const metadata = { title: "Your TRAIT order", robots: {index:false,follow:false}, referrer:"no-referrer" as const };
/** `?pay=1` (straight from checkout with "Pay online") opens Razorpay Checkout once. */
export default async function Page({params,searchParams}:{params:Promise<{token:string}>;searchParams:Promise<{pay?:string|string[]}>}) { return <LiveTracking token={(await params).token} confirmation autoPay={(await searchParams).pay==="1"}/>; }
