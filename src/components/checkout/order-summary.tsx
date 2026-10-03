import {quantityOptionText} from "@/lib/pricing";
import Image from "next/image";
import Link from "next/link";
import type { CartItem } from "@/types/cart";
import type { ReactNode } from "react";
import type { CheckoutDetails, OrderTotals } from "@/types/order";
import { formatMoney, formatWeight } from "@/lib/format";
import { SERVICE_CITY, SERVICE_STATE } from "@/lib/order";

export function OrderSummary({ items, totals, editable = false, deliveryConfirmed = true, pickup = false, feeVaries = false, coupon, action, id }: { items: readonly CartItem[]; totals: OrderTotals; editable?: boolean; deliveryConfirmed?: boolean; pickup?: boolean; feeVaries?: boolean; coupon?: ReactNode; action?: ReactNode; id?: string }) {
  return <section id={id} className="order-panel order-summary" aria-labelledby="order-summary-title">
    <div className="summary-heading"><h2 id="order-summary-title">Order summary <span className="item-badge">{items.length} {items.length === 1 ? "item" : "items"}</span></h2>{editable && <Link href="/cart">Edit cart</Link>}</div>
    <p className="raw-price-note">Each item is priced using its displayed weight or unit.</p>
    <ul className="order-lines">{items.map(item => <li key={item.id}>
      <Image className="order-item-image" src={item.image} alt={item.imageAlt} width={64} height={64} />
      <div className="order-item-copy"><div className="order-line-heading"><h3>{item.productName}</h3><strong>{formatMoney(item.lineTotalPaise)}</strong></div>
      <p>{item.preparation.label} <span aria-hidden="true">&middot;</span> {quantityOptionText(item,item.rawWeightGrams??item.quantity??0)}</p>
      {item.estimatedCleanedWeightGrams !== undefined && <p className="order-cleaned">Estimated cleaned weight: ~{formatWeight(item.estimatedCleanedWeightGrams)}</p>}
      {item.specialInstructions && <p className="order-instructions">Notes: {item.specialInstructions}</p>}</div>
    </li>)}</ul>
    {coupon}
    <dl className="order-totals"><div><dt>Subtotal</dt><dd>{formatMoney(totals.subtotalPaise)}</dd></div>{!!totals.discountPaise && <div><dt>{totals.offer?.code ? "Coupon (" + totals.offer.code + ")" : "Offer discount" + (totals.offer?.title ? " — " + totals.offer.title : "")}</dt><dd className="order-discount">−{formatMoney(totals.discountPaise)}</dd></div>}<div><dt>Delivery</dt><dd data-delivery-fee>{pickup ? "Free (store pickup)" : (!deliveryConfirmed && feeVaries ? "from " : "") + formatMoney(totals.deliveryChargePaise)}</dd></div><div className="order-grand-total"><dt>Total</dt><dd data-order-total>{formatMoney(totals.grandTotalPaise)}</dd></div></dl>
    {!!totals.discountPaise && <p className="coupon-savings">You save {formatMoney(totals.discountPaise)} on this order</p>}
    {action && <div className="order-summary-action">{action}</div>}
    {!pickup && <p className="field-help">Free for store pickup.</p>}
    {!deliveryConfirmed && <p className="field-help">The final total for your pincode is confirmed when you review your order.</p>}
    <p className="field-help">Cleaning estimates are approximate, not guaranteed delivered weights.</p>
  </section>;
}
export function CustomerDetails({ customer }: { customer: CheckoutDetails }) {
  return <dl className="customer-details"><div><dt>Customer</dt><dd>{customer.name}<br />{customer.mobile}</dd></div><div><dt>{customer.deliveryMethod === "delivery" ? "Home Delivery" : "Store Pickup"}</dt><dd>{customer.deliveryMethod === "delivery" ? <>{customer.address}<br />{customer.locality}, {SERVICE_CITY}, {SERVICE_STATE} {customer.pincode}{customer.landmark && <><br />Landmark: {customer.landmark}</>}</> : "Store Pickup"}</dd></div><div><dt>Payment method</dt><dd>{customer.paymentMethod === "cash" ? "Cash" : "UPI"} at {customer.deliveryMethod === "pickup" ? "pickup" : "delivery"}</dd></div></dl>;
}
