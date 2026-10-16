"use client";

import Link from "next/link";
import { reviewCheckout, placeCheckout, lookupSavedAddresses } from "@/app/checkout/actions";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useCart, clearCart, useBuyNow, clearBuyNow } from "@/lib/cart-store";
import { serializeCart } from "@/lib/cart";
import { normalizeMobile, orderTotals, validateCheckout, SERVICE_CITY, SERVICE_STATE } from "@/lib/order";
import { formatMoney } from "@/lib/format";
import { saveCheckoutDraft, savePendingCheckout, useOrderState } from "@/lib/order-store";
import { ADDRESS_LABELS, type AddressLabel, type CheckoutDetails, type CheckoutErrors, type OrderTotals, type SavedAddressOption } from "@/types/order";
import { CustomerDetails, OrderSummary } from "./order-summary";
import { CouponPicker } from "@/components/cart/coupon-picker";
import { appliedCoupon, type CartOffer } from "@/lib/cart-offer";
import { useCoupon } from "@/lib/coupon-store";
import { quantityOptionText } from "@/lib/pricing";
import { shopOrderKey, type ShopOrderDetails } from "@/lib/whatsapp";
import { rememberCustomer, useSavedCustomer } from "@/lib/saved-customer";
import { slotDate, slotDayName, slotLabel, slotRange, slotTime, type SlotDay } from "@/lib/delivery-slots";

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
export function CheckoutContent({ buyNow = false, deliveryFeePaise = null, feeVaries = false, offers = [], slotDays = [], asapOpen = false }: { buyNow?: boolean; deliveryFeePaise?: number | null; feeVaries?: boolean; offers?: readonly CartOffer[]; slotDays?: readonly SlotDay[]; asapOpen?: boolean }) {
  const cart = useCart();
  const buyNowItems = useBuyNow();
  // Buy now checks out only its own item; the cart is left as it was.
  const items = buyNow ? buyNowItems : cart;
  const clearItems = buyNow ? clearBuyNow : clearCart;
  const coupon = useCoupon();
  const applied = appliedCoupon(offers, coupon, items);
  const { ready, draft, pending } = useOrderState();
  const router = useRouter();
  const [quote, setQuote] = useState<Awaited<ReturnType<typeof reviewCheckout>>["quote"]>();
  const [review, setReview] = useState(false);
  const [reviewedCart, setReviewedCart] = useState("");
  const [errors, setErrors] = useState<CheckoutErrors>({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const submitting = useRef(false);
  // Name and mobile remembered on this device to prefill; saved addresses come from the server, masked.
  const saved = useSavedCustomer();
  const [saveAs, setSaveAs] = useState<AddressLabel>();
  const prefilled = useRef(false);
  const mobileKey = /^[6-9]\d{9}$/.test(normalizeMobile(draft.mobile)) ? normalizeMobile(draft.mobile) : "";
  const [lookup, setLookup] = useState<{ mobile: string; addresses: SavedAddressOption[] }>();
  // undefined: the last used address; null: "Use a different address".
  const [chosenSaved, setChosenSaved] = useState<string | null>();
  const savedAddresses = lookup?.mobile === mobileKey ? lookup.addresses : [];
  const selectedSaved = draft.deliveryMethod === "delivery" && chosenSaved !== null ? savedAddresses.find(a => a.id === chosenSaved) ?? savedAddresses[0] : undefined;
  const newLabel = saveAs ?? ADDRESS_LABELS.find(l => !savedAddresses.some(a => a.label === l)) ?? "Other";
  // A saved choice counts only while that slot is still open; the server re-checks cutoff and capacity.
  const slotDay = slotDays.find(d => d.date === draft.slotDate);
  const chosenSlot = slotDay?.slots.find(s => s.id === draft.slotId && s.status === "open");
  const [shownDate, setShownDate] = useState(() => (chosenSlot && slotDay?.date) || slotDays.find(d => d.slots.some(s => s.status === "open"))?.date || slotDays[0]?.date || "");
  const shownDay = slotDays.find(d => d.date === shownDate) ?? slotDays[0];
  // A saved address goes to the server by id only; a new delivery address is saved under its label.
  const details: CheckoutDetails = { ...draft, slotId: chosenSlot?.id, slotDate: chosenSlot ? draft.slotDate : undefined, ...(selectedSaved ? { savedAddressId: selectedSaved.id } : draft.deliveryMethod === "delivery" ? { addressLabel: newLabel } : {}) };
  // "Now (ASAP)" is the default while the shop is open: no slot chosen means ASAP. When it is closed, a slot is required.
  const asap = asapOpen && !chosenSlot;
  const when = draft.deliveryMethod === "pickup" ? "Pick up" : "Deliver";
  const title = useRef<HTMLHeadingElement>(null);
  // Before review, the applied coupon is estimated in the browser; the review step shows the server's recalculated quote.
  function withCoupon(totals: OrderTotals): OrderTotals {
    return applied ? { ...totals, discountPaise: applied.discountPaise, offer: { title: applied.offer.title, code: applied.offer.code }, grandTotalPaise: totals.grandTotalPaise - applied.discountPaise } : totals;
  }
  // The confirmation page's "Send order to shop on WhatsApp" message lists these; only this browser session has them.
  function rememberForShop(trackingToken: string) {
    const details: ShopOrderDetails = { items: items.map(i => i.productName + " · " + i.preparation.label + " · " + quantityOptionText(i, i.rawWeightGrams ?? i.quantity ?? 0) + (i.specialInstructions ? " (Cutting instructions: " + i.specialInstructions + ")" : "")),
      address: draft.deliveryMethod === "pickup" || selectedSaved ? undefined : [draft.address, draft.locality, draft.landmark && "Landmark: " + draft.landmark, draft.city || SERVICE_CITY, draft.pincode].filter(Boolean).join(", ") };
    try { sessionStorage.setItem(shopOrderKey(trackingToken), JSON.stringify(details)); } catch { /* The message then has no items or address. */ }
  }
  // Prefill empty name and mobile once per visit.
  useEffect(() => {
    if (!ready || !saved || prefilled.current) return;
    prefilled.current = true;
    saveCheckoutDraft({ ...draft, name: draft.name || saved.name, mobile: draft.mobile || saved.mobile });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, saved]);
  // After a valid mobile, its saved addresses (masked). Not while reviewing, so the quoted address can't change.
  useEffect(() => {
    if (!mobileKey || draft.deliveryMethod !== "delivery" || review || lookup?.mobile === mobileKey) return;
    let live = true;
    const timer = setTimeout(() => {
      lookupSavedAddresses(mobileKey).then(result => { if (live) setLookup({ mobile: mobileKey, addresses: "addresses" in result ? result.addresses : [] }); })
        .catch(() => { if (live) setLookup({ mobile: mobileKey, addresses: [] }); });
    }, 400);
    return () => { live = false; clearTimeout(timer); };
  }, [mobileKey, draft.deliveryMethod, review, lookup?.mobile]);
  function chooseSaved(id: string | null) {
    setChosenSaved(id);
    setErrors({}); setError(""); setQuote(undefined); setReview(false);
  }
  function focusTitle() { requestAnimationFrame(() => title.current?.focus()); }
  function change(key: keyof CheckoutDetails, value: string) {
    saveCheckoutDraft({ ...draft, [key]: value });
    setErrors({}); setError(""); setQuote(undefined); setReview(false);
  }
  function chooseAsap() {
    saveCheckoutDraft({ ...draft, slotDate: undefined, slotId: undefined });
    setErrors({}); setError(""); setQuote(undefined); setReview(false);
  }
  function chooseSlot(date: string, id: string) {
    saveCheckoutDraft({ ...draft, slotDate: date, slotId: id });
    setErrors({}); setError(""); setQuote(undefined); setReview(false);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const invalid = validateCheckout(details);
    if (slotDays.length && !chosenSlot && !asapOpen) invalid.slotId = "Choose a " + (draft.deliveryMethod === "pickup" ? "pickup" : "delivery") + " slot.";
    setErrors(invalid); setError("");
    if (Object.keys(invalid).length) {
      setReview(false);
      requestAnimationFrame(() => document.getElementById("checkout-" + (invalid.slotId ? "slotId" : Object.keys(invalid)[0]))?.focus());
      return;
    }
    if (!review) {
      submitting.current=true; setSaving(true);
      try {const result=await reviewCheckout(items,details,applied?applied.offer.code:null);if(!result.quote){setError(result.error??"Quote unavailable.");return;}setQuote(result.quote);setReviewedCart(serializeCart(items));setReview(true);focusTitle();}
      catch {setError("Connection interrupted. Please try reviewing your order again.");}
      finally {submitting.current=false;setSaving(false);}
      return;
    }
    if (reviewedCart !== serializeCart(items)) { setReview(false); setError((buyNow ? "Your item" : "Your cart") + " changed. Please review the updated summary before placing your order."); focusTitle(); return; }
    submitting.current = true; setSaving(true);
    try {
      if (!quote) throw new Error("Review your order first.");
      savePendingCheckout(quote.envelope);
      const order = await placeCheckout(quote.envelope);
      if ("error" in order) {if(order.reviewRequired){savePendingCheckout(null);setReview(false);}throw new Error(order.error);}
      savePendingCheckout(null);
      rememberForShop(order.trackingToken);
      rememberCustomer({ name: draft.name, mobile: draft.mobile });
      clearItems();
      router.replace("/order-confirmation/" + order.trackingToken);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not place your order. Please try again.");
      submitting.current = false; setSaving(false);
    }
  }
  async function retryPending() {
    if(!pending||submitting.current)return;
    submitting.current=true;setSaving(true);
    try {const result=await placeCheckout(pending);if("trackingToken" in result){savePendingCheckout(null);rememberForShop(result.trackingToken);clearItems();router.replace("/order-confirmation/"+result.trackingToken);}else{if(result.reviewRequired){savePendingCheckout(null);setReview(false);}setError(result.error);}}
    catch {setError("Connection interrupted. Retry this same pending order to check confirmation.");}
    finally {submitting.current=false;setSaving(false);}
  }
  function renderField(field: typeof fields[number]) {
    return field.key === "city" || field.key === "state" ? <div key={field.key}>
      <label htmlFor={"checkout-" + field.key}>{field.label}</label>
      <input id={"checkout-" + field.key} name={field.key} type="text" value={field.key === "city" ? SERVICE_CITY : SERVICE_STATE} readOnly aria-readonly="true" className="checkout-fixed" />
    </div> : <div key={field.key} className={field.key === "address" ? "checkout-field-wide" : ""}>
      <label htmlFor={"checkout-" + field.key}>{field.label}{field.key !== "landmark" && !(field.key === "name" && draft.deliveryMethod === "pickup") ? " *" : " (optional)"}</label>
      <input id={"checkout-" + field.key} name={field.key} type={field.key === "mobile" ? "tel" : "text"} inputMode={field.key === "pincode" ? "numeric" : field.key === "mobile" ? "tel" : "text"} autoComplete={field.autoComplete} maxLength={field.max} required={field.key !== "landmark" && !(field.key === "name" && draft.deliveryMethod === "pickup")} value={draft[field.key] ?? ""} onChange={event => change(field.key, event.target.value)} aria-invalid={!!errors[field.key]} aria-describedby={errors[field.key] ? "error-" + field.key : undefined} />
      {errors[field.key] && <p className="cart-error" id={"error-" + field.key}>{errors[field.key]}</p>}
    </div>;
  }
  if (ready && pending) return <div className="container page-section"><h1>Confirm your pending order</h1><p>A previous submission needs confirmation. Retry the same order to avoid placing it twice.</p>{error&&<p role="alert">{error}</p>}<button className="button primary" disabled={saving} onClick={retryPending}>{saving?"Checking…":"Check order confirmation"}</button></div>;
  if (!ready) return <div className="container page-section"><p role="status">Loading your checkout...</p></div>;
  if (!items.length && !saving) return <div className="container page-section"><p className="eyebrow">Checkout</p><h1>{buyNow ? "Nothing to buy yet" : "Your cart is empty"}</h1><p>{buyNow ? "Choose a product and press Buy now to check it out on its own." : "Add a selection before starting checkout."}</p><Link className="button secondary" href="/search">Continue shopping</Link></div>;
  const totals = quote && review ? quote : withCoupon(orderTotals(items, draft.deliveryMethod, deliveryFeePaise ?? 0));
  const actionLabel = saving ? "Please wait..." : review ? "Place order" : "Continue";
  return <div className="container page-section checkout-page">
    {buyNow ? <Link className="back-link" href="/search">&larr; Continue shopping</Link> : <Link className="back-link" href="/cart">&larr; Back to cart</Link>}
    <div className="checkout-top"><div className="checkout-title"><h1 ref={title} tabIndex={-1}>{review ? "Review your order" : "Checkout"}</h1><p className="checkout-title-note">Your selection. Every detail considered.</p></div>
    <ol className="checkout-steps" aria-label="Checkout progress"><li aria-current={!review ? "step" : undefined}>1. Your details</li><li aria-current={review ? "step" : undefined}>2. Review & place</li></ol></div>
    <p className="order-preview-note">Final prices, delivery eligibility and charges are checked before you place your order.</p>
    <button type="button" className="checkout-summary-toggle" aria-expanded={summaryOpen} aria-controls="checkout-summary" onClick={() => setSummaryOpen(!summaryOpen)}><span>{summaryOpen ? "Hide" : "Show"} order summary <span aria-hidden="true">{summaryOpen ? "▴" : "▾"}</span></span><strong>{formatMoney(totals.grandTotalPaise)}</strong></button>
    <div className={(review ? "checkout-layout checkout-review" : "checkout-layout") + (summaryOpen ? " summary-open" : "")}><form id="checkout-form" noValidate onSubmit={submit} className="checkout-form"><fieldset disabled={saving} style={{border:0,padding:0,minWidth:0}}>
      {error && <p role="alert" className="cart-error">{error}</p>}
      {Object.keys(errors).length > 0 && <p role="alert" className="cart-error">Please correct the highlighted fields.</p>}
      {review ? <section className="order-panel"><h2>Ready for a final look?</h2><CustomerDetails customer={draft} savedAddress={selectedSaved} slot={chosenSlot && draft.slotDate ? slotLabel({ ...chosenSlot, date: draft.slotDate }) : asap ? "Now (ASAP)" : undefined} /><p className="field-help">Please review the current prices and delivery charge.</p><button className="plain-button" type="button" onClick={() => { setReview(false); focusTitle(); }}>Edit details</button></section> : <><section className="order-panel checkout-details-panel">
        <fieldset><legend><span className="section-number">1</span> Delivery method</legend><div className="checkout-options">{([ ["delivery", "Home Delivery"], ["pickup", "Store Pickup"] ] as const).map(([value, label]) => <label className="choice" key={value}><input type="radio" name="deliveryMethod" value={value} checked={draft.deliveryMethod === value} onChange={() => change("deliveryMethod", value)} />{label}</label>)}</div></fieldset>
        {shownDay && <fieldset className="slot-picker" id="checkout-slotId" tabIndex={-1} aria-invalid={!!errors.slotId} aria-describedby={errors.slotId ? "error-slotId" : undefined}><legend><span className="section-number">2</span> {draft.deliveryMethod === "pickup" ? "Pickup" : "Delivery"} time</legend>
          {asapOpen && <label className="slot-card slot-asap"><input type="radio" name="slot" value="asap" checked={asap} onChange={chooseAsap} /><span className="slot-name">{when} now (ASAP)</span><small>{draft.deliveryMethod === "pickup" ? "We start preparing it right away" : "We prepare and send it right away"}</small></label>}
          {asapOpen && <p className="slot-or">Or choose a slot</p>}
          <div className="slot-days" role="group" aria-label="Day">{slotDays.map(d => { const free = d.slots.some(s => s.status === "open"); return <button type="button" key={d.date} className="slot-day" aria-pressed={d.date === shownDay.date} onClick={() => setShownDate(d.date)}><strong>{slotDayName(d.date)}</strong><small>{free ? slotDate(d.date).replace(/^\w+, /, "") : "No slots left"}</small></button>; })}</div>
          <div className="slot-cards">{shownDay.slots.map(s => { const open = s.status === "open"; const today = slotDayName(shownDay.date) === "Today"; return <label key={s.id} className={"slot-card" + (open ? "" : " is-unavailable")}>
            <input type="radio" name="slot" value={s.id} disabled={!open} checked={open && chosenSlot?.id === s.id && draft.slotDate === shownDay.date} onChange={() => chooseSlot(shownDay.date, s.id)} />
            <span className="slot-name">{s.name}</span><span className="slot-time">{slotRange(s.startsAt, s.endsAt)}</span>
            <small>{s.status === "full" ? "Full" : s.status === "closed" ? "Closed" : today ? "Order by " + slotTime(s.cutoffAt) : "Available"}</small></label>; })}</div>
          {errors.slotId && <p className="cart-error" id="error-slotId">{errors.slotId}</p>}
        </fieldset>}
        <h2><span className="section-number">{shownDay ? 3 : 2}</span> Your details</h2><p className="field-help">Fields marked * are required.</p>
        <div className="checkout-fields">{fields.filter(field => field.key === "name" || field.key === "mobile").map(renderField)}</div>
        {draft.deliveryMethod === "delivery" && savedAddresses.length > 0 && <fieldset className="saved-addresses"><legend>Deliver to</legend><div className="saved-address-list">
          {savedAddresses.map(a => <label className="choice saved-address" key={a.id}><input type="radio" name="savedAddress" checked={selectedSaved?.id === a.id} onChange={() => chooseSaved(a.id)} /><span><strong>{a.label}</strong><small>{a.masked}</small></span></label>)}
          <label className="choice saved-address"><input type="radio" name="savedAddress" checked={!selectedSaved} onChange={() => chooseSaved(null)} /><span><strong>Use a different address</strong></span></label>
        </div></fieldset>}
        {draft.deliveryMethod === "delivery" && !selectedSaved && <div className="checkout-fields">{fields.filter(field => field.key !== "name" && field.key !== "mobile").map(renderField)}</div>}
        <div className="remember-details">
          {draft.deliveryMethod === "delivery" && !selectedSaved && <fieldset className="save-as"><legend>Save this address as</legend>{ADDRESS_LABELS.map(label => <label className="choice" key={label}><input type="radio" name="saveAs" checked={newLabel === label} onChange={() => setSaveAs(label)} />{label}</label>)}</fieldset>}
          {draft.deliveryMethod === "delivery" && !selectedSaved && newLabel !== "Other" && savedAddresses.some(a => a.label === newLabel) && <p className="field-help">This replaces your saved {newLabel} address.</p>}
          <p className="field-help">We save your details to process and deliver your orders.</p>
        </div>
        {draft.deliveryMethod === "pickup" && <p className="field-help">No delivery address is needed. See our delivery and pickup page for the store location and opening hours.</p>}
        </section><fieldset className="order-panel payment-panel"><legend><span className="section-number">{shownDay ? 4 : 3}</span> Payment method</legend><div className="checkout-options">{([ ["cash", draft.deliveryMethod === "pickup" ? "Cash at pickup" : "Cash on Delivery"], ["upi", "UPI at delivery / pickup"] ] as const).map(([value, label]) => <label className="choice" key={value}><input type="radio" name="paymentMethod" value={value} checked={draft.paymentMethod === value} onChange={() => change("paymentMethod", value)} />{label}</label>)}</div><p className="field-help">Pay by cash or UPI when you receive your order at delivery or pickup.</p></fieldset>
      </>}
    </fieldset></form><OrderSummary id="checkout-summary" deliveryConfirmed={!!quote && review} pickup={draft.deliveryMethod === "pickup"} feeVaries={feeVaries} editable={!buyNow} items={quote && review ? items.map((item,i)=>({...item,...quote.lines[i]})) : items} totals={totals} coupon={<CouponPicker offers={offers} items={items} applied={applied} onChange={() => { setError(""); setQuote(undefined); setReview(false); }} />}
      action={<><button type="submit" form="checkout-form" className="button primary checkout-submit" disabled={saving || !items.length}>{actionLabel}</button>{error && <p className="cart-error checkout-action-error">{error}</p>}</>} /></div>
    <div className="checkout-bottom-bar"><div><small>Total</small><strong>{formatMoney(totals.grandTotalPaise)}</strong></div><button type="submit" form="checkout-form" className="button primary" disabled={saving || !items.length}>{actionLabel}</button></div>
  </div>;
}
