"use client";
import { createPortal } from "react-dom";
import { startTransition, useActionState, useEffect, useId, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import type { Product } from "@/types/catalog";
import { notifyWhenAvailable, type RestockState } from "@/app/restock/actions";
import { RESTOCK_DAYS } from "@/lib/restock";

const PUSH_KEY = process.env.NEXT_PUBLIC_TRAIT_WEB_PUSH_PUBLIC_KEY ?? "";
const noSubscribe = () => () => {};
function pushSupported() { return !!PUSH_KEY && typeof window !== "undefined" && window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window; }
/** This browser's push subscription for back-in-stock alerts, or null if the shopper declines or it is unavailable. */
async function browserSubscription(): Promise<string | null> {
  if ((await Notification.requestPermission()) !== "granted") return null;
  const registration = await navigator.serviceWorker.register("/restock-sw.js");
  await navigator.serviceWorker.ready;
  const key = Uint8Array.from(atob(PUSH_KEY.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
  const subscription = await registration.pushManager.getSubscription() ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  return JSON.stringify(subscription);
}

/** Mobile number (with its consent line) and optional browser alert for one sold-out product. */
export function RestockNotifyForm({ product, autoFocus }: { product: Product; autoFocus?: boolean }) {
  const id = useId();
  const [state, action, pending] = useActionState<RestockState, FormData>(notifyWhenAvailable, {});
  // Browser alerts are offered only where they can work (never during server rendering).
  const canPush = useSyncExternalStore(noSubscribe, () => pushSupported() && Notification.permission !== "denied", () => false);
  const [preparing, setPreparing] = useState(false);
  const [note, setNote] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setNote("");
    if (form.get("browser") === "yes") {
      setPreparing(true);
      try { const push = await browserSubscription(); if (push) form.set("push", push); else setNote("Browser alerts are blocked, so we'll use WhatsApp only."); }
      catch { setNote("Browser alerts aren't available here, so we'll use WhatsApp only."); }
      setPreparing(false);
    }
    startTransition(() => action(form));
  }
  if (state.ok) return <p className="restock-success" role="status">{state.message}{note && " " + note}</p>;
  const busy = pending || preparing;
  return <form className="restock-form" onSubmit={submit}>
    <input type="hidden" name="product" value={product.id} />
    <label htmlFor={id + "-mobile"}>Mobile number</label>
    <div className="restock-mobile"><span aria-hidden="true">+91</span><input id={id + "-mobile"} name="mobile" type="tel" inputMode="numeric" autoComplete="tel-national" required pattern="[6-9][0-9]{9}" maxLength={10} placeholder="10-digit mobile" autoFocus={autoFocus} aria-describedby={id + "-consent"} /></div>
    {canPush && <label className="restock-browser"><input type="checkbox" name="browser" value="yes" /> <span>Also alert me in this browser</span></label>}
    <p id={id + "-consent"} className="restock-consent">By tapping Notify me, you agree TRAIT may message this number on WhatsApp once when {product.name} is back. No marketing; the request ends after {RESTOCK_DAYS} days.</p>
    {(state.message || note) && <p className={state.available ? "restock-success" : "cart-error"} role="alert">{state.message ?? note}</p>}
    <button type="submit" className="button primary restock-submit notify-button" disabled={busy}>{preparing ? "Allow alerts…" : pending ? "Saving…" : "Notify me"}</button>
  </form>;
}

/** A small modal with RestockNotifyForm; opened from a sold-out product card. */
export function RestockNotifyDialog({ product, onClose }: { product: Product; onClose: () => void }) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current, previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element?.showModal();
    return () => { element?.close(); if (previousFocus?.isConnected) previousFocus.focus(); };
  }, []);
  return createPortal(<dialog ref={dialog} className="selection-dialog restock-dialog" aria-labelledby={id + "-title"} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="selection-heading"><h2 id={id + "-title"}>Notify me when available</h2><button type="button" className="close-button" onClick={onClose} aria-label="Close"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" /></svg></button></div>
    <div className="restock-body"><p className="restock-product-name"><strong>{product.name}</strong> is sold out right now.</p><RestockNotifyForm product={product} autoFocus /></div>
  </dialog>, document.body);
}
