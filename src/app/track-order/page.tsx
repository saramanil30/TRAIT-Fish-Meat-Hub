import Link from "next/link";
import { OrderLookup } from "@/components/checkout/order-lookup";
export const metadata={title:"Track your order",description:"Check the status of your TRAIT order with the mobile number you used."};
export default function Page(){return <div className="container page-section"><p className="eyebrow">TRAIT orders</p><h1>Track your order</h1><OrderLookup/><p className="order-lookup-note">You can also open the private tracking link from your order confirmation.</p><Link href="/">Continue shopping</Link></div>;}
