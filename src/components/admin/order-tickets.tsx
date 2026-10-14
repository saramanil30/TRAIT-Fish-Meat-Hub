import Link from "next/link";
import { staffRpc } from "@/lib/admin/server";
import { formatMoney, formatWeight } from "@/lib/format";
import { deliveryAddress } from "@/lib/address";
import { slotLabel, type OrderSlot } from "@/lib/delivery-slots";
import { PrintNow } from "./print-now";

type Ticket = {
 order: { id: string; order_number: string; status: string; fulfillment_method: string; total_paise: number; created_at: string; discount_paise?: number; fulfillment_snapshot?: { name?: string; mobileE164?: string; address?: Record<string, string>; slot?: OrderSlot } };
 items: { id: string; raw_weight_grams: number | null; sale_quantity?: number; pricing_basis?: string; units_per_pack?: number; line_total_paise: number; instructions: string; product_snapshot: { productName: string; preparationName: string } }[];
 payments: { id: string; method: string; status: string; amountPaise: number }[];
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const paymentText: Record<string, string> = { PENDING: "UNPAID", VERIFYING: "CHECKING", PAID: "PAID", FAILED: "FAILED", REFUNDED: "REFUNDED" };
function amount(i: Ticket["items"][number]) {
 if (i.pricing_basis === "TRAY") return i.sale_quantity + " tray" + (i.sale_quantity === 1 ? "" : "s");
 if (i.pricing_basis === "UNIT") return i.sale_quantity + " unit" + (i.sale_quantity === 1 ? "" : "s");
 return formatWeight(Number(i.raw_weight_grams ?? i.sale_quantity ?? 0)) + (i.pricing_basis === "NET_WEIGHT" ? " NET" : " raw");
}
const weighed = (i: Ticket["items"][number]) => !i.pricing_basis || i.pricing_basis === "RAW_WEIGHT" || i.pricing_basis === "NET_WEIGHT";

/** Packing slip / cut ticket for each order, one per printed page. Every order is read through the permission-checked order_detail. */
export async function OrderTickets({ token, ids, back }: { token: string; ids: string[]; back: string }) {
 const wanted = [...new Set(ids.filter(id => UUID.test(id)))].slice(0, 25);
 const tickets = (await Promise.all(wanted.map(id => staffRpc<Ticket>(token, "order_detail", { target_order: id }).catch(() => null)))).filter((t): t is Ticket => !!t);
 return <div className="trait-admin order-print">
  <div className="order-print-bar"><Link className="admin-button secondary" href={back}>Back to orders</Link><PrintNow count={tickets.length}/></div>
  {!tickets.length && <p>No orders to print.</p>}
  {tickets.map(({ order, items, payments }) => {
   const c = order.fulfillment_snapshot, pickup = order.fulfillment_method === "STORE_PICKUP", address = deliveryAddress(c?.address), payment = payments[payments.length - 1];
   return <article key={order.id} className="ticket">
    <header><strong className="ticket-number">{order.order_number}</strong><span className="ticket-mode">{pickup ? "PICKUP" : "DELIVERY"}</span></header>
    <p className="ticket-when">{c?.slot ? slotLabel(c.slot) : "ASAP"}</p>
    <p className="ticket-small">Placed {new Date(order.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })}</p>
    <ol className="ticket-items">{items.map(i => <li key={i.id}>
     <div><strong>{i.product_snapshot.productName}</strong><span>{amount(i)}</span></div>
     <p>{i.product_snapshot.preparationName}</p>
     {i.instructions && <p className="ticket-cut">Cut: {i.instructions}</p>}
     {weighed(i) && <p className="ticket-fill">Actual weight: ________ g</p>}
    </li>)}</ol>
    <div className="ticket-total"><span>{items.length} item{items.length === 1 ? "" : "s"}{order.discount_paise ? " · offer −" + formatMoney(Number(order.discount_paise)) : ""}</span><strong>{formatMoney(Number(order.total_paise))}</strong></div>
    {payment && <p className="ticket-pay">{payment.method} · {paymentText[payment.status] ?? payment.status}{payment.method === "CASH" && payment.status === "PENDING" ? " · collect " + formatMoney(Number(payment.amountPaise)) : ""}</p>}
    <div className="ticket-customer">
     <strong>{c?.name || "Customer"}</strong>{c?.mobileE164 && <span> · {c.mobileE164}</span>}
     {pickup ? <p>Store pickup</p> : <><p>{address.line}</p>{address.landmark && <p>Landmark: {address.landmark}</p>}</>}
    </div>
   </article>;
  })}
 </div>;
}
