import {quantityText} from "@/lib/pricing";
import Image from "next/image";
import Link from "next/link";
import type { CartItem } from "@/types/cart";
import type { CheckoutDetails, OrderTotals } from "@/types/order";
import { formatMoney, formatWeight } from "@/lib/format";

export function OrderSummary({ items, totals, editable = false, deliveryConfirmed = true }: { items: readonly CartItem[]; totals: OrderTotals; editable?: boolean; deliveryConfirmed?: boolean }) {
  return <section className="order-panel order-summary" aria-labelledby="order-summary-title">
    <div className="summary-heading"><h2 id="order-summary-title">Order summary <span className="item-badge">{items.length} {items.length === 1 ? "item" : "items"}</span></h2>{editable && <Link href="/cart">Edit cart</Link>}</div>
    <p className="raw-price-note">Each item is priced using its displayed weight or unit.</p>
    <ul className="order-lines">{items.map(item => <li key={item.id}>
      <Image className="order-item-image" src={item.image} alt={item.imageAlt} width={64} height={64} />
      <div className="order-item-copy"><div className="order-line-heading"><h3>{item.productName}</h3><strong>{formatMoney(item.lineTotalPaise)}</strong></div>
      <p>{item.preparation.label} <span aria-hidden="true">&middot;</span> {quantityText(item,item.rawWeightGrams??item.quantity??0)}</p>
      {item.estimatedCleanedWeightGrams !== undefined && <p className="order-cleaned">Estimated cleaned weight: ~{formatWeight(item.estimatedCleanedWeightGrams)}</p>}
      {item.specialInstructions && <p className="order-instructions">Notes: {item.specialInstructions}</p>}</div>
    </li>)}</ul>
    <dl className="order-totals"><div><dt>Subtotal</dt><dd>{formatMoney(totals.subtotalPaise)}</dd></div>{!!totals.discountPaise && <div><dt>Offer discount{totals.offer?.title ? " — " + totals.offer.title : ""}</dt><dd>−{formatMoney(totals.discountPaise)}</dd></div>}<div><dt>Delivery charge</dt><dd>{deliveryConfirmed ? formatMoney(totals.deliveryChargePaise) : "Checked at review"}</dd></div><div className="order-grand-total"><dt>{deliveryConfirmed ? "Grand total" : "Subtotal before delivery"}</dt><dd data-order-total>{formatMoney(totals.grandTotalPaise)}</dd></div></dl>
    <p className="field-help">Cleaning estimates are approximate, not guaranteed delivered weights.</p>
  </section>;
}
export function CustomerDetails({ customer }: { customer: CheckoutDetails }) {
  return <dl className="customer-details"><div><dt>Customer</dt><dd>{customer.name}<br />{customer.mobile}</dd></div><div><dt>{customer.deliveryMethod === "delivery" ? "Home Delivery" : "Store Pickup"}</dt><dd>{customer.deliveryMethod === "delivery" ? <>{customer.address}<br />{customer.locality} - {customer.pincode}{customer.landmark && <><br />Landmark: {customer.landmark}</>}</> : "Store Pickup"}</dd></div><div><dt>Payment method</dt><dd>{customer.paymentMethod === "cash" ? "Cash" : "UPI"} at {customer.deliveryMethod === "pickup" ? "pickup" : "delivery"}</dd></div></dl>;
}
