"use client";
import { useState } from "react";
import type { CartItem } from "@/types/cart";
import { couponDiscount, shortfallMessage, type AppliedCoupon, type CartOffer } from "@/lib/cart-offer";
import { setCoupon, useCoupon } from "@/lib/coupon-store";
import { formatMoney } from "@/lib/format";

/** "Apply coupon" row: lists active offers; nothing is discounted until the customer applies one. */
export function CouponPicker({ offers, items, applied, onChange }: { offers: readonly CartOffer[]; items: readonly CartItem[]; applied: AppliedCoupon | null; onChange?: () => void }) {
  const code = useCoupon();
  const [open, setOpen] = useState(false);
  function choose(next: string | null) { setCoupon(next); setOpen(false); onChange?.(); }
  if (code) {
    const offer = offers.find(o => o.code === code);
    const short = !applied && offer ? shortfallMessage(offer, items) : null;
    return <div className="coupon-box coupon-applied" role="status">
    {applied ? <p><strong>{code}</strong> applied <span aria-hidden="true">✓</span> <span aria-hidden="true">·</span> You saved {formatMoney(applied.discountPaise)}</p>
      : short ? <p className="coupon-short">{short}</p>
      : <p><strong>{code}</strong> can&rsquo;t be applied to these items</p>}
    <button type="button" className="plain-button" onClick={() => choose(null)}>Remove</button>
  </div>;
  }
  if (!offers.length) return null;
  return <div className="coupon-box">
    <button type="button" className="coupon-toggle" aria-expanded={open} aria-controls="coupon-list" onClick={() => setOpen(!open)}>
      <span>Apply coupon</span><span aria-hidden="true">{open ? "−" : "›"}</span>
    </button>
    {open && <ul id="coupon-list" className="coupon-list">{offers.map(offer => {
      const usable = couponDiscount(offer, items);
      const short = usable ? null : shortfallMessage(offer, items);
      return <li key={offer.id}>
        <div><strong className="coupon-code">{offer.code}</strong><p>{offer.title}</p><small>{usable || short ? offer.condition : offer.condition + ". Add eligible items to use it."}</small>{short && <small className="coupon-short">{short}</small>}</div>
        <button type="button" className="button secondary" disabled={!usable} onClick={() => choose(offer.code)} aria-label={"Apply coupon " + offer.code}>Apply</button>
      </li>;
    })}</ul>}
  </div>;
}
