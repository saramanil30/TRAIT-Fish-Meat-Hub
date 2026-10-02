"use client";
import {isRaw, priceLabel, quantityLabel, quantityOptionText, quantityOptions, saleTotal} from "@/lib/pricing";


import Image from "next/image";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { Product, PreparationId } from "@/types/catalog";
import type { CartItem } from "@/types/cart";
import { applicableCleaningLoss, estimateCleanedWeightGrams, MAX_INSTRUCTIONS_LENGTH } from "@/lib/cart";
import { addCartItem, setBuyNowItem, updateCartItem } from "@/lib/cart-store";
import { formatMoney, formatWeight } from "@/lib/format";

export const BUY_NOW_CHECKOUT = "/checkout?buy=now";

/** Whether the shopper has to pick a preparation or quantity before buying. */
export function needsOptions(product: Product) {
  return product.preparationOptions.length > 1 || quantityOptions(product).length > 1;
}

export function ProductSelection({ product, item, onClose, onSaved }: { product: Product; item?: CartItem; onClose: () => void; onSaved: () => void }) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const submitting = useRef(false);
  const [preparationId, setPreparationId] = useState<PreparationId>(item?.preparationId ?? product.preparationOptions[0].id);
  const [rawWeightGrams, setRawWeightGrams] = useState(item?.rawWeightGrams ?? item?.quantity ?? quantityOptions(product)[0]);
  const [instructions, setInstructions] = useState(item?.specialInstructions ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const router = useRouter();
  const preparation = product.preparationOptions.find(option => option.id === preparationId)!;
  const loss = applicableCleaningLoss(product, preparation);
  const estimated = estimateCleanedWeightGrams(rawWeightGrams, loss);
  const price = saleTotal(product, rawWeightGrams);

  useEffect(() => {
    const element = dialog.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    element?.showModal();
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();
    return () => {
      element?.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  function trapFocus(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== "Tab") return;
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])")).filter(element => element.getClientRects().length > 0);
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setSaving(true);
    try {
      const selection = { preparationId, ...(isRaw(product)?{rawWeightGrams}:{quantity:rawWeightGrams}), specialInstructions: instructions };
      if (!item && (event.nativeEvent as SubmitEvent).submitter?.hasAttribute("data-buy-now")) {
        setBuyNowItem(product.id, selection, crypto.randomUUID());
        router.push(BUY_NOW_CHECKOUT);
        return;
      }
      if (item) updateCartItem(item.id, selection);
      else addCartItem(product.id, selection, crypto.randomUUID());
      onSaved();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update your cart. Please try again.");
      submitting.current = false;
      setSaving(false);
    }
  }

  return createPortal(<dialog onKeyDown={trapFocus} ref={dialog} className="selection-dialog" aria-labelledby={id + "-title"} onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="selection-heading"><div><p className="eyebrow">Prepared your way</p><h2 id={id + "-title"}>{item ? "Edit your selection" : "Choose your selection"}</h2></div><button ref={closeButton} type="button" className="close-button" onClick={onClose} aria-label="Close product selection"><span aria-hidden="true">&times;</span></button></div>
    <form onSubmit={submit} className="selection-form">
      <div className="selection-content">
        <div className="selection-product"><Image src={product.image} alt={product.imageAlt} width={224} height={168} /><div><h3>{product.name}</h3>{product.localName && <p>{product.localName}</p>}<p><strong>{priceLabel(product)}</strong></p><span>{product.available ? "Available" : "Sold out"}</span></div></div>
        <fieldset><legend>Preparation</legend><div className="choice-grid">{product.preparationOptions.map(option => <label className="choice" key={option.id}><input type="radio" name={id + "-preparation"} value={option.id} checked={preparationId === option.id} onChange={() => setPreparationId(option.id)} /><span>{option.label}</span></label>)}</div>{estimated !== undefined && <p className="cleaning-estimate" aria-live="polite">After cleaning: about {formatWeight(estimated)} (~{loss}% removed). An estimate, not a guarantee.</p>}</fieldset>
        <fieldset><legend>{product.pricingBasis === "NET_WEIGHT" ? <>Quantity <small className="weight-note">net weight</small></> : quantityLabel(product)}</legend><div className="choice-grid weights">{quantityOptions(product).map(weight => <label className="choice" key={weight}><input type="radio" name={id + "-weight"} value={weight} checked={rawWeightGrams === weight} onChange={() => setRawWeightGrams(weight)} /><span>{quantityOptionText(product,weight)}</span></label>)}</div></fieldset>
        <label className="instructions-label" htmlFor={id + "-instructions"}>Special instructions <span>(optional)</span></label>
        <textarea id={id + "-instructions"} value={instructions} onChange={event => setInstructions(event.target.value)} maxLength={MAX_INSTRUCTIONS_LENGTH} rows={3} placeholder="For example: please make the pieces small" aria-describedby={id + "-instructions-help"} />
        <p id={id + "-instructions-help"} className="field-help">{instructions.length}/{MAX_INSTRUCTIONS_LENGTH} characters. Please do not include personal or payment details.</p>
        {error && <p role="alert" className="cart-error">{error}</p>}
      </div>
      <div className="selection-footer"><div className="selection-total-row"><div><span>Item price</span><strong aria-live="polite" data-item-price>{formatMoney(price)}</strong><small aria-live="polite">For {quantityOptionText(product,rawWeightGrams)}</small></div><div className="selection-actions"><button type="submit" className="button primary" disabled={saving || !product.available}>{saving ? "Saving..." : item ? "Save changes" : "Add to Cart"}</button>{!item && <button type="submit" data-buy-now className="button secondary" disabled={saving || !product.available}>Buy now</button>}</div></div></div>
    </form>
  </dialog>, document.body);
}
