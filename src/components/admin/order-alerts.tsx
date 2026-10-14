"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { pollOrderAlerts, type OrderAlert, type OrderAlertCursor } from "@/app/admin/actions";
import { formatMoney } from "@/lib/format";
import { slotDayName, slotRange } from "@/lib/delivery-slots";

const POLL_MS = 15000, RECENT_MAX = 20;
const STATE_KEY = "trait-order-alerts-v2", SOUND_KEY = "trait-order-sound";
type Item = { order: OrderAlert; read: boolean; toast: boolean };
type Saved = { cursor: OrderAlertCursor; items: Item[] };
type Sound = "off" | "blocked" | "on";

// One store shared by the toasts, the header bell and the Orders tab badge.
const none: Item[] = [];
let items: Item[] = none, sound: Sound = "off", cursor: OrderAlertCursor = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
function setItems(next: Item[]) {
 items = next; emit();
 try { sessionStorage.setItem(STATE_KEY, JSON.stringify({ cursor, items } satisfies Saved)); } catch { /* Alerts still work for this page. */ }
}
function setSound(next: Sound) { sound = next; emit(); }
// Every way of opening an order (Orders row, ?order= link, bell, toast, notification) marks it read here.
const markRead = (id: string) => { if (items.some(i => i.order.id === id && (!i.read || i.toast))) setItems(items.map(i => i.order.id === id ? { ...i, read: true, toast: false } : i)); };
const closeToast = (id: string) => setItems(items.map(i => i.order.id === id ? { ...i, toast: false } : i));
const markAllRead = () => setItems(items.map(i => ({ ...i, read: true, toast: false })));
const unreadCount = () => items.filter(i => !i.read).length;

// Browsers block audio until the person clicks, so the beep needs an AudioContext resumed from a click.
let audio: AudioContext | null = null;
function beep(times: number) {
 if (!audio || audio.state !== "running" || sound !== "on") return;
 for (let i = 0; i < times; i++) {
  const at = audio.currentTime + i * 0.45, osc = audio.createOscillator(), gain = audio.createGain();
  osc.type = "sine"; osc.frequency.value = 880;
  gain.gain.setValueAtTime(0.0001, at); gain.gain.exponentialRampToValueAtTime(0.4, at + 0.02); gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.3);
  osc.connect(gain).connect(audio.destination); osc.start(at); osc.stop(at + 0.32);
 }
}
/** Called from a click: turns sound on (and remembers it) or off. */
async function toggleSound() {
 if (sound !== "off") { try { localStorage.setItem(SOUND_KEY, "off"); } catch { /* Not remembered. */ } setSound("off"); return; }
 try { audio ??= new AudioContext(); await audio.resume(); localStorage.setItem(SOUND_KEY, "on"); } catch { /* Sound unavailable here. */ }
 setSound(audio?.state === "running" ? "on" : "blocked");
 beep(1);
 if ("Notification" in window && Notification.permission === "default") void Notification.requestPermission().catch(() => undefined);
}

const orderHref = (base: string, o: OrderAlert) => base + "/orders?store=" + o.store_id + "&order=" + o.id;
function when(o: OrderAlert) { return o.slot ? slotDayName(o.slot.date) + " " + o.slot.name + " " + slotRange(o.slot.startsAt, o.slot.endsAt) : "ASAP"; }
function detail(o: OrderAlert) { return [formatMoney(Number(o.total_paise)), o.fulfillment_method === "HOME_DELIVERY" ? "Delivery" : "Pickup", when(o)].join(" · "); }
function ago(iso: string) { const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000)); return m < 1 ? "just now" : m < 60 ? m + " min ago" : Math.floor(m / 60) + " h ago"; }

/** Unread new orders; shown on the Orders tab. */
export function OrderAlertCount() {
 const count = useSyncExternalStore(subscribe, unreadCount, () => 0);
 return count ? <span className="order-alert-count" aria-label={count + " unread"}>{count}</span> : null;
}

/** Header bell: unread badge, recent new orders, mark as read and the sound toggle. */
export function OrderBell({ base }: { base: string }) {
 const list = useSyncExternalStore(subscribe, () => items, () => none);
 const soundState = useSyncExternalStore(subscribe, () => sound, () => "off" as Sound);
 const [open, setOpen] = useState(false);
 const [place, setPlace] = useState<{ top: number; right: number; width: number }>();
 const root = useRef<HTMLDivElement>(null);
 // Fixed under the bell, right-aligned to it, and kept 16px inside both screen edges (phones included).
 const toggle = () => {
  const bell = root.current?.getBoundingClientRect();
  if (!open && bell) { const view = document.documentElement.clientWidth, width = Math.min(380, view - 32); setPlace({ top: bell.bottom + 8, width, right: Math.max(16, Math.min(view - bell.right, view - 16 - width)) }); }
  setOpen(!open);
 };
 const unread = list.filter(i => !i.read).length;
 useEffect(() => {
  if (!open) return;
  const outside = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
  const escape = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
  const close = () => setOpen(false);
  document.addEventListener("pointerdown", outside); document.addEventListener("keydown", escape); window.addEventListener("resize", close); window.addEventListener("scroll", close, { passive: true });
  return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); window.removeEventListener("resize", close); window.removeEventListener("scroll", close); };
 }, [open]);
 return <div className="order-bell" ref={root}>
  <button type="button" className="order-bell-button" aria-expanded={open} aria-haspopup="true" aria-label={"New orders" + (unread ? ", " + unread + " unread" : "")} onClick={toggle}>
   <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round"/></svg>
   {unread > 0 && <span className="order-alert-count">{unread > 99 ? "99+" : unread}</span>}
  </button>
  {open && <div className="order-bell-panel" role="dialog" aria-label="New orders" style={place}>
   <div className="order-bell-head"><strong>New orders</strong>{unread > 0 && <button type="button" className="admin-text-button" onClick={markAllRead}>Mark all as read</button>}</div>
   {list.length ? <ul>{[...list].reverse().map(({ order: o, read }) => <li key={o.id} className={read ? undefined : "is-unread"}>
    <Link href={orderHref(base, o)} onClick={() => { markRead(o.id); setOpen(false); }}><strong>{o.order_number}</strong> {detail(o)}<small>{o.store_name} · {ago(o.created_at)}</small></Link>
    {!read && <button type="button" className="order-bell-read" aria-label={"Mark " + o.order_number + " as read"} title="Mark as read" onClick={() => markRead(o.id)}>✓</button>}
   </li>)}</ul> : <p className="order-bell-empty">No new orders since you opened the workspace.</p>}
   <button type="button" className="order-bell-sound" role="switch" aria-checked={soundState !== "off"} onClick={() => void toggleSound()}>
    <span>Order sound</span><span className="order-switch" aria-hidden="true"/>{soundState === "blocked" && <small>Tap anywhere to allow sound</small>}
   </button>
  </div>}
 </div>;
}

/** Polls every 15 s for orders newer than the last seen (the database limits each role to its stores); shows a toast per new order. */
export function OrderAlerts({ base }: { base: string }) {
 const list = useSyncExternalStore(subscribe, () => items, () => none);
 const soundState = useSyncExternalStore(subscribe, () => sound, () => "off" as Sound);
 const started = useRef(false);
 const opened = useSearchParams().get("order");

 // An order opened by link (?order=) or by expanding its row on the Orders page counts as read.
 useEffect(() => { if (opened) markRead(opened); }, [opened, list]);
 useEffect(() => {
  const toggled = (e: Event) => { const row = e.target; if (row instanceof HTMLDetailsElement && row.open && row.dataset.orderId) markRead(row.dataset.orderId); };
  document.addEventListener("toggle", toggled, true);
  return () => document.removeEventListener("toggle", toggled, true);
 }, []);

 // Restore this tab's alerts and the remembered sound choice (re-armed on the first click or key press).
 useEffect(() => {
  try { const saved = JSON.parse(sessionStorage.getItem(STATE_KEY) ?? "null") as Saved | null; if (saved && Array.isArray(saved.items)) { cursor = saved.cursor; setItems(saved.items); } } catch { /* Start fresh. */ }
  let wanted = false; try { wanted = localStorage.getItem(SOUND_KEY) === "on"; } catch { /* Off. */ }
  if (!wanted) return;
  try { audio ??= new AudioContext(); } catch { return; }
  const ctx = audio, sync = () => { if (sound !== "off") setSound(ctx.state === "running" ? "on" : "blocked"); };
  setSound(ctx.state === "running" ? "on" : "blocked");
  ctx.addEventListener("statechange", sync);
  const arm = () => void ctx.resume().catch(() => undefined);
  window.addEventListener("pointerdown", arm, { once: true }); window.addEventListener("keydown", arm, { once: true });
  return () => { ctx.removeEventListener("statechange", sync); window.removeEventListener("pointerdown", arm); window.removeEventListener("keydown", arm); };
 }, []);

 useEffect(() => {
  let busy = false, disposed = false;
  const poll = async () => {
   if (busy) return; busy = true;
   try {
    const result = await pollOrderAlerts(cursor);
    if (!result || disposed) return;
    const first = !started.current && !cursor; started.current = true;
    cursor = result.cursor;
    const fresh = first ? [] : result.orders.filter(o => !items.some(i => i.order.id === o.id));
    if (!fresh.length) { setItems(items); return; }
    setItems([...items, ...fresh.map(order => ({ order, read: false, toast: true }))].slice(-RECENT_MAX));
    beep(fresh.length);
    if (document.visibilityState === "hidden" && "Notification" in window && Notification.permission === "granted") {
     for (const o of fresh) {
      try {
       const n = new Notification("New order " + o.order_number, { body: detail(o), tag: "order-" + o.id });
       n.onclick = () => { window.focus(); markRead(o.id); window.location.assign(orderHref(base, o)); n.close(); };
      } catch { /* Some mobile browsers only notify from a service worker. */ }
     }
    }
   } finally { busy = false; }
  };
  void poll();
  const timer = window.setInterval(() => void poll(), POLL_MS);
  return () => { disposed = true; window.clearInterval(timer); };
 }, [base]);

 const toasts = list.filter(i => i.toast);
 if (!toasts.length && soundState !== "blocked") return null;
 return <div className="order-alerts" aria-live="polite">
  {soundState === "blocked" && <button type="button" className="admin-button secondary order-alerts-sound" onClick={() => void audio?.resume()}>🔔 Tap to enable order sound</button>}
  {toasts.map(({ order: o }) => <div key={o.id} className="order-alert" role="status">
   <Link href={orderHref(base, o)} onClick={() => markRead(o.id)}>🔔 New order {o.order_number}<small>{detail(o)}</small></Link>
   <button type="button" aria-label={"Close alert for " + o.order_number} onClick={() => closeToast(o.id)}>×</button>
  </div>)}
 </div>;
}
