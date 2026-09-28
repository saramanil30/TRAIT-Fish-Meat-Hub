"use client";

import Link from "next/link";
import { reviewCheckout, placeCheckout } from "@/app/checkout/actions";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { useCart, clearCart } from "@/lib/cart-store";
import { serializeCart } from "@/lib/cart";
import { orderTotals, validateCheckout } from "@/lib/order";
import { saveCheckoutDraft, savePendingCheckout, useOrderState } from "@/lib/order-store";
import type { CheckoutDetails, CheckoutErrors } from "@/types/order";
import { CustomerDetails, OrderSummary } from "./order-summary";

const fields = [
  { key: "name", label: "Customer Name", autoComplete: "name", max: 80 },
  { key: "mobile", label: "Mobile Number", autoComplete: "tel", max: 20 },
  { key: "address", label: "Address", autoComplete: "street-address", max: 240 },
  { key: "locality", label: "Area / Locality", autoComplete: "address-level2", max: 100 },
  { key: "landmark", label: "Landmark", autoComplete: "off", max: 150 },
  { key: "city", label: "City", autoComplete: "address-level2", max: 120 },
  { key: "state", label: "State", autoComplete: "address-level1", max: 120 },
  { key: "pincode", label: "Pincode", autoComplete: "postal-code", max: 6 },
] as const;
export function CheckoutContent() {
  const items = useCart();
  const { ready, draft, pending } = useOrderState();
  const router = useRouter();
  const [quote, setQuote] = useState<Awaited<ReturnType<typeof reviewCheckout>>["quote"]>();
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
    setErrors({}); setError(""); setQuote(undefined); setReview(false);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const invalid = validateCheckout(draft);
    setErrors(invalid); setError("");
    if (Object.keys(invalid).length) {
      setReview(false);
      requestAnimationFrame(() => document.getElementById("checkout-" + Object.keys(invalid)[0])?.focus());
      return;
    }
    if (!review) {
      submitting.current=true; setSaving(true);
      try {const result=await reviewCheckout(items,draft);if(!result.quote){setError(result.error??"Quote unavailable.");return;}setQuote(result.quote);setReviewedCart(serializeCart(items));setReview(true);focusTitle();}
      catch {setError("Connection interrupted. Please try reviewing your order again.");}
      finally {submitting.current=false;setSaving(false);}
      return;
    }
    if (reviewedCart !== serializeCart(items)) { setReview(false); setError("Your cart changed. Please review the updated summary before placing your order."); focusTitle(); return; }
    submitting.current = true; setSaving(true);
    try {
      if (!quote) throw new Error("Review your order first.");
      savePendingCheckout(quote.envelope);
      const order = await placeCheckout(quote.envelope);
      if ("error" in order) {if(order.reviewRequired){savePendingCheckout(null);setReview(false);}throw new Error(order.error);}
      savePendingCheckout(null);
      clearCart();
      router.replace("/order-confirmation/" + order.trackingToken);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not place your order. Please try again.");
      submitting.current = false; setSaving(false);
    }
  }
  async function retryPending() {
    if(!pending||submitting.current)return;
    submitting.current=true;setSaving(true);
    try {const result=await placeCheckout(pending);if("trackingToken" in result){savePendingCheckout(null);clearCart();router.replace("/order-confirmation/"+result.trackingToken);}else{if(result.reviewRequired){savePendingCheckout(null);setReview(false);}setError(result.error);}}
    catch {setError("Connection interrupted. Retry this same pending order to check confirmation.");}
    finally {submitting.current=false;setSaving(false);}
  }
  if (ready && pending) return <div className="container page-section"><h1>Confirm your pending order</h1><p>A previous submission needs confirmation. Retry the same order to avoid placing it twice.</p>{error&&<p role="alert">{error}</p>}<button className="button primary" disabled={saving} onClick={retryPending}>{saving?"Checking…":"Check order confirmation"}</button></div>;
  if (!ready) return <div className="container page-section"><p role="status">Loading your checkout...</p></div>;
  if (!items.length && !saving) return <div className="container page-section"><p className="eyebrow">Checkout</p><h1>Your cart is empty</h1><p>Add a selection before starting checkout.</p><Link className="button secondary" href="/search">Continue shopping</Link></div>;
  return <div className="container page-section checkout-page">
    <Link className="back-link" href="/cart">&larr; Back to cart</Link><p className="eyebrow">Prepared your way</p>
    <div className="checkout-title"><h1 ref={title} tabIndex={-1}>{review ? "Review your order" : "Checkout"}</h1><span className="checkout-title-note">Your selection. Every detail considered.</span></div>
    <p className="order-preview-note">Final prices, delivery eligibility and charges are checked before you place your order.</p>
    <ol className="checkout-steps" aria-label="Checkout progress"><li aria-current={!review ? "step" : undefined}>1. Your details</li><li aria-current={review ? "step" : undefined}>2. Review & place</li></ol>
    <div className={review ? "checkout-layout checkout-review" : "checkout-layout"}><form noValidate onSubmit={submit} className="checkout-form"><fieldset disabled={saving} style={{border:0,padding:0,minWidth:0}}>
      {error && <p role="alert" className="cart-error">{error}</p>}
      {Object.keys(errors).length > 0 && <p role="alert" className="cart-error">Please correct the highlighted fields.</p>}
      {review ? <section className="order-panel"><h2>Ready for a final look?</h2><CustomerDetails customer={draft} /><p className="field-help">Please review the current prices and delivery charge. Online payment remains pending until verified.</p><button className="plain-button" type="button" onClick={() => { setReview(false); focusTitle(); }}>Edit details</button></section> : <><section className="order-panel checkout-details-panel">
        <fieldset><legend><span className="section-number">1</span> Delivery method</legend><div className="checkout-options">{([ ["delivery", "Home Delivery"], ["pickup", "Store Pickup"] ] as const).map(([value, label]) => <label className="choice" key={value}><input type="radio" name="deliveryMethod" value={value} checked={draft.deliveryMethod === value} onChange={() => change("deliveryMethod", value)} />{label}</label>)}</div></fieldset>
        <h2>Your details</h2><p className="field-help">Fields marked * are required.</p>
        <div className="checkout-fields">{fields.filter(field => draft.deliveryMethod === "delivery" || ["name", "mobile"].includes(field.key)).map(field => <div key={field.key} className={field.key === "address" ? "checkout-field-wide" : ""}>
          <label htmlFor={"checkout-" + field.key}>{field.label}{field.key !== "landmark" && !(field.key === "name" && draft.deliveryMethod === "pickup") ? " *" : " (optional)"}</label>
          <input id={"checkout-" + field.key} name={field.key} type={field.key === "mobile" ? "tel" : "text"} inputMode={field.key === "pincode" ? "numeric" : field.key === "mobile" ? "tel" : "text"} autoComplete={field.autoComplete} maxLength={field.max} required={field.key !== "landmark" && !(field.key === "name" && draft.deliveryMethod === "pickup")} value={draft[field.key] ?? ""} onChange={event => change(field.key, event.target.value)} aria-invalid={!!errors[field.key]} aria-describedby={errors[field.key] ? "error-" + field.key : undefined} />
          {errors[field.key] && <p className="cart-error" id={"error-" + field.key}>{errors[field.key]}</p>}
        </div>)}</div>
        {draft.deliveryMethod === "pickup" && <p className="field-help">No delivery address is needed. See our delivery and pickup page for the store location and opening hours.</p>}
        </section><fieldset className="order-panel payment-panel"><legend><span className="section-number">2</span> Payment method</legend><div className="checkout-options">{([ ["cash", draft.deliveryMethod === "pickup" ? "Cash at pickup" : "Cash on Delivery"], ["upi", "UPI preference"] ] as const).map(([value, label]) => <label className="choice" key={value}><input type="radio" name="paymentMethod" value={value} checked={draft.paymentMethod === value} onChange={() => change("paymentMethod", value)} />{label}</label>)}</div><p className="field-help">Cash is collected at delivery or pickup. UPI records a preference only; online payment is not available here yet. Do not send money based on this page.</p></fieldset>
      </>}
      <button type="submit" className="button primary checkout-submit" disabled={saving || !items.length}>{saving ? "Please wait..." : review ? "Place order" : "Review order"}</button>
    </fieldset></form><OrderSummary deliveryConfirmed={!!quote && review} editable items={quote && review ? items.map((item,i)=>({...item,...quote.lines[i]})) : items} totals={quote ?? orderTotals(items, draft.deliveryMethod, 0)} /></div>
  </div>;
}
