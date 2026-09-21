"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { useCart, clearCart } from "@/lib/cart-store";
import { serializeCart } from "@/lib/cart";
import { orderTotals, validateCheckout } from "@/lib/order";
import { placeLocalOrder, saveCheckoutDraft, useOrderState } from "@/lib/order-store";
import type { CheckoutDetails, CheckoutErrors } from "@/types/order";
import { CustomerDetails, OrderSummary } from "./order-summary";

const fields = [
  { key: "name", label: "Customer Name", autoComplete: "name", max: 80 },
  { key: "mobile", label: "Mobile Number", autoComplete: "tel", max: 20 },
  { key: "address", label: "Address", autoComplete: "street-address", max: 300 },
  { key: "locality", label: "Area / Locality", autoComplete: "address-level2", max: 100 },
  { key: "landmark", label: "Landmark", autoComplete: "off", max: 150 },
  { key: "pincode", label: "Pincode", autoComplete: "postal-code", max: 6 },
] as const;
export function CheckoutContent() {
  const items = useCart();
  const { ready, draft } = useOrderState();
  const router = useRouter();
  const [review, setReview] = useState(false);
  const [reviewedCart, setReviewedCart] = useState("");
  const [errors, setErrors] = useState<CheckoutErrors>({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const title = useRef<HTMLHeadingElement>(null);
  function focusTitle() { requestAnimationFrame(() => title.current?.focus()); }
  function change(key: keyof CheckoutDetails, value: string) {
    saveCheckoutDraft({ ...draft, [key]: value });
    setErrors({}); setError("");
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const invalid = validateCheckout(draft);
    setErrors(invalid); setError("");
    if (Object.keys(invalid).length) {
      setReview(false);
      requestAnimationFrame(() => document.getElementById("checkout-" + Object.keys(invalid)[0])?.focus());
      return;
    }
    if (!review) { setReviewedCart(serializeCart(items)); setReview(true); focusTitle(); return; }
    if (reviewedCart !== serializeCart(items)) { setReview(false); setError("Your cart changed. Please review the updated summary before placing your mock order."); focusTitle(); return; }
    submitting.current = true; setSaving(true);
    try {
      const order = placeLocalOrder(items, draft);
      clearCart();
      router.replace("/order-confirmation/" + order.trackingToken);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the local preview. Please try again.");
      submitting.current = false; setSaving(false);
    }
  }
  if (!ready) return <div className="container page-section"><p role="status">Loading your checkout...</p></div>;
  if (!items.length && !saving) return <div className="container page-section"><p className="eyebrow">Checkout</p><h1>Your cart is empty</h1><p>Add a selection before starting checkout.</p><Link className="button secondary" href="/search">Continue shopping</Link></div>;
  return <div className="container page-section checkout-page">
    <Link className="back-link" href="/cart">&larr; Back to cart</Link><p className="eyebrow">Prepared your way</p>
    <h1 ref={title} tabIndex={-1}>{review ? "Review your order" : "Checkout"}</h1>
    <p className="order-preview-note">Local preview only. No real order is sent to TRAIT and no payment is collected. Please use sample details.</p>
    <ol className="checkout-steps" aria-label="Checkout progress"><li aria-current={!review ? "step" : undefined}>1. Your details</li><li aria-current={review ? "step" : undefined}>2. Review & place</li></ol>
    <div className={review ? "checkout-layout checkout-review" : "checkout-layout"}><form noValidate onSubmit={submit} className="order-panel checkout-form">
      {error && <p role="alert" className="cart-error">{error}</p>}
      {Object.keys(errors).length > 0 && <p role="alert" className="cart-error">Please correct the highlighted fields.</p>}
      {review ? <><h2>Ready for a final look?</h2><CustomerDetails customer={draft} /><p className="field-help">Your details stay in this browser tab. Final payment handling will be connected later.</p><button className="plain-button" type="button" onClick={() => { setReview(false); focusTitle(); }}>Edit details</button></> : <>
        <fieldset><legend>Delivery method</legend><div className="checkout-options">{([ ["delivery", "Home Delivery"], ["pickup", "Store Pickup"] ] as const).map(([value, label]) => <label className="choice" key={value}><input type="radio" name="deliveryMethod" value={value} checked={draft.deliveryMethod === value} onChange={() => change("deliveryMethod", value)} />{label}</label>)}</div></fieldset>
        <h2>Your details</h2><p className="field-help">Fields marked * are required.</p>
        <div className="checkout-fields">{fields.filter(field => draft.deliveryMethod === "delivery" || ["name", "mobile"].includes(field.key)).map(field => <div key={field.key} className={field.key === "address" ? "checkout-field-wide" : ""}>
          <label htmlFor={"checkout-" + field.key}>{field.label}{field.key !== "landmark" ? " *" : " (optional)"}</label>
          <input id={"checkout-" + field.key} name={field.key} type={field.key === "mobile" ? "tel" : "text"} inputMode={field.key === "pincode" ? "numeric" : field.key === "mobile" ? "tel" : "text"} autoComplete={field.autoComplete} maxLength={field.max} required={field.key !== "landmark"} value={draft[field.key]} onChange={event => change(field.key, event.target.value)} aria-invalid={!!errors[field.key]} aria-describedby={errors[field.key] ? "error-" + field.key : undefined} />
          {errors[field.key] && <p className="cart-error" id={"error-" + field.key}>{errors[field.key]}</p>}
        </div>)}</div>
        {draft.deliveryMethod === "pickup" && <p className="field-help">No delivery address is needed. Pickup location and timing will be connected with live ordering.</p>}
        <fieldset><legend>Payment method</legend><div className="checkout-options">{([ ["cash", "Cash"], ["upi", "UPI"] ] as const).map(([value, label]) => <label className="choice" key={value}><input type="radio" name="paymentMethod" value={value} checked={draft.paymentMethod === value} onChange={() => change("paymentMethod", value)} />{label}</label>)}</div><p className="field-help">Choose your preference. Final payment handling will be connected later. No transfer or payment is required now.</p></fieldset>
      </>}
      <button type="submit" className="button primary checkout-submit" disabled={saving || !items.length}>{saving ? "Creating local preview..." : review ? "Place mock order" : "Review order"}</button>
    </form><OrderSummary items={items} totals={orderTotals(items, draft.deliveryMethod)} /></div>
  </div>;
}
