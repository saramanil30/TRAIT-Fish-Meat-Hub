"use client";
import {isRaw,priceLabel,quantityLabel,quantityOptions,quantityText} from "@/lib/pricing";

import Image from "next/image";
import Link from "next/link";
import { useRef, useState } from "react";
import { useCatalogue } from "@/lib/cart-store";
import { useCart, removeCartItem, clearCart, updateCartItem } from "@/lib/cart-store";
import { cartSubtotalPaise } from "@/lib/cart";
import { formatMoney, formatWeight } from "@/lib/format";
import { ProductSelection } from "@/components/product/product-selection";


export function CartContent() {
  const items = useCart();
  const products = useCatalogue();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const editing = items.find(item => item.id === editingId);
  const editingProduct = products.find(product => product.id === editing?.productId);

  return <div className="container page-section cart-page">
          <Link href="/search" className="back-link">Home / Shop / Your cart</Link><p className="eyebrow">Your choices, your way</p>
          <div className="cart-title"><h1 ref={heading} tabIndex={-1}>Your cart <span>({items.length})</span></h1><Link href="/search" className="button secondary">Continue shopping</Link></div>
          <p className="page-intro">Review your selection before checkout.</p>
          <p className="cart-notice">Prices are based on raw weight. Cleaning estimates are approximate, not guaranteed delivered weights. Cart choices are kept in this browser tab when storage is available.</p>
          <p role="status" className="cart-status">{message}</p>
          {error && <p role="alert" className="cart-error">{error}</p>}
          {items.length === 0 ? <div className="empty-results"><h2>Your cart is empty</h2><p>Find your favourite fish or meat, then choose your raw weight and preparation.</p><Link href="/search" className="button primary">Explore the collection</Link></div> : <div className="cart-layout"><div className="cart-items"><div className="cart-table-heading" aria-hidden="true"><span>Product</span><span>Preparation</span><span>Raw weight</span><span>Total</span></div>
            {items.map(item => {
              const product = products.find(product => product.id === item.productId)!;
        return (
            <article
              className="cart-item cart-item-row"
              key={item.id}
              aria-labelledby={"cart-name-" + item.id}
            >
              <div className="cart-product">
                <Image
                  src={item.image}
                  alt={item.imageAlt}
                  width={88}
                  height={72}
                />

                <div className="cart-product-info">
                  <h2 id={"cart-name-" + item.id}>{item.productName}</h2>

                  {item.localName && (
                    <p className="cart-local-name">{item.localName}</p>
                  )}

                  <p className="cart-unit-price">
                    {priceLabel(item)}
                  </p>
                </div>
              </div>

            <div className="cart-column">
              <span className="cart-column-label">Preparation</span>
              <strong>{item.preparation.label}</strong>
            </div>

            <div className="cart-column cart-weight-column">
              <label
                className="cart-column-label"
                htmlFor={"weight-" + item.id}
              >
                {quantityLabel(item)}
              </label>

        <select
          id={"weight-" + item.id}
          value={item.rawWeightGrams??item.quantity}
          onChange={event => {
            try {
              updateCartItem(item.id, {
                preparationId: item.preparationId,
                ...(isRaw(product)?{rawWeightGrams:Number(event.target.value)}:{quantity:Number(event.target.value)}),
                specialInstructions: item.specialInstructions,
              });

              setError("");
              setMessage(item.productName + " raw weight updated.");
            } catch (cause) {
              setError(
                cause instanceof Error
                  ? cause.message
                  : "Could not update weight."
              );
            }
          }}
        >
        {quantityOptions(product).map(weight => (
          <option key={weight} value={weight}>
            {quantityText(product,weight)}
          </option>
        ))}
      </select>
    </div>

    {item.estimatedCleanedWeightGrams !== undefined && (
      <div className="cart-column cart-cleaned-column">
        <span className="cart-column-label">After cleaning</span>
        <strong>~{formatWeight(item.estimatedCleanedWeightGrams)}</strong>
        <small>Approx. {item.cleaningLossPercent}% cleaning loss</small>
      </div>
    )}

    <div className="cart-price-column">
      <span className="cart-column-label">Price</span>
      <strong className="cart-line-total">
        {formatMoney(item.lineTotalPaise)}
      </strong>
    </div>

    <div className="cart-row-actions">
      <button
        type="button"
        className="plain-button"
        onClick={() => setEditingId(item.id)}
        aria-label={"Edit " + item.productName + " selection"}
      >
        Edit
      </button>

      <button
        type="button"
        className="plain-button"
        aria-label={"Remove " + item.productName}
        onClick={() => {
          removeCartItem(item.id);
          setMessage(item.productName + " removed.");
          heading.current?.focus();
        }}
      >
        Remove
      </button>
    </div>

    {item.specialInstructions && (
      <p className="cart-instructions cart-row-instructions">
        <strong>Special instructions:</strong>{" "}
        {item.specialInstructions}
      </p>
    )}
  </article>
);
      })}
      {confirmClear ? <div className="clear-confirm" role="group" aria-label="Confirm clearing cart"><p>Remove all items from your cart?</p><button type="button" className="button secondary" onClick={() => setConfirmClear(false)}>Keep items</button><button type="button" className="button primary" onClick={() => { clearCart(); setConfirmClear(false); setMessage("Cart cleared."); heading.current?.focus(); }}>Clear all items</button></div> : <button type="button" className="plain-button clear-cart" onClick={() => setConfirmClear(true)}>Clear cart</button>}
    </div><aside className="cart-summary" aria-labelledby="summary-title"><h2 id="summary-title">Order summary <span className="item-badge">{items.length} {items.length === 1 ? "item" : "items"}</span></h2><p>{items.length} {items.length === 1 ? "item" : "items"} <span aria-hidden="true">&middot;</span> {formatWeight(items.reduce((sum, item) => sum + (item.rawWeightGrams??0), 0))} raw weight</p><div className="subtotal"><span>Subtotal</span><strong aria-live="polite" data-subtotal>{formatMoney(cartSubtotalPaise(items))}</strong></div><p className="summary-note">Each item uses its displayed raw-weight, NET-weight or unit price. Delivery charges are shown at checkout after choosing delivery or pickup.</p><Link href="/checkout" className="button primary cart-checkout">Proceed to Checkout</Link><p className="checkout-note">Final prices and delivery eligibility are checked at checkout.</p></aside></div>}
    {editing && editingProduct && <ProductSelection key={editing.id} product={editingProduct} item={editing} onClose={() => setEditingId(null)} onSaved={() => { setError(""); setMessage(editing.productName + " selection updated."); }} />}
  </div>;
}
