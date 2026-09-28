import Link from "next/link";
export const metadata={title:"Track your order"};
export default function Page(){return <div className="container page-section"><h1>Track your order</h1><p>Open the private tracking link you received after placing your order. Order numbers and mobile numbers cannot be used to access an order.</p><Link href="/">Continue shopping</Link></div>;}
