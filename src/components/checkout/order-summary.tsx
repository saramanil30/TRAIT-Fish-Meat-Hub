import type { CartItem } from "@/types/cart";
import type { CheckoutDetails, OrderTotals } from "@/types/order";
import { formatMoney, formatWeight } from "@/lib/format";

export function OrderSummary({ items, totals }: { items: readonly CartItem[]; totals: OrderTotals }) {
  return <section className="order-panel order-summary" aria-labelledby="order-summary-title">
    <h2 id="order-summary-title">Your order summary</h2>
    <p className="raw-price-note">Pricing is based on <strong>RAW WEIGHT</strong>, before cleaning.</p>
    <ul className="order-lines">{items.map(item => <li key={item.id}>
      <div className="order-line-heading"><h3>{item.productName}</h3><strong>{formatMoney(item.lineTotalPaise)}</strong></div>
      <p>{item.preparation.label} <span aria-hidden="true">&middot;</span> {formatWeight(item.rawWeightGrams)} raw ordered weight</p>
      {item.estimatedCleanedWeightGrams !== undefined && <p className="order-cleaned">Estimated cleaned weight: ~{formatWeight(item.estimatedCleanedWeightGrams)}</p>}
      {item.specialInstructions && <p className="order-instructions">Notes: {item.specialInstructions}</p>}
    </li>)}</ul>
    <dl className="order-totals"><div><dt>Subtotal</dt><dd>{formatMoney(totals.subtotalPaise)}</dd></div><div><dt>Delivery charge <small>(mock)</small></dt><dd>{formatMoney(totals.deliveryChargePaise)}</dd></div><div className="order-grand-total"><dt>Grand total</dt><dd data-order-total>{formatMoney(totals.grandTotalPaise)}</dd></div></dl>
    <p className="field-help">Sample prices. Cleaning estimates are approximate, not guaranteed delivered weights.</p>
  </section>;
}
export function CustomerDetails({ customer }: { customer: CheckoutDetails }) {
  return <dl className="customer-details"><div><dt>Customer</dt><dd>{customer.name}<br />{customer.mobile}</dd></div><div><dt>{customer.deliveryMethod === "delivery" ? "Home Delivery" : "Store Pickup"}</dt><dd>{customer.deliveryMethod === "delivery" ? <>{customer.address}<br />{customer.locality} - {customer.pincode}{customer.landmark && <><br />Landmark: {customer.landmark}</>}</> : "Pickup location and timing will be confirmed when live ordering is available."}</dd></div><div><dt>Payment method</dt><dd>{customer.paymentMethod === "cash" ? "Cash" : "UPI"} - no payment collected</dd></div></dl>;
}
