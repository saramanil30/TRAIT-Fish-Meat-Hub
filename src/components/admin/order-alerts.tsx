"use client";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import Link from "next/link";
import { pollOrderAlerts, type OrderAlert, type OrderAlertCursor } from "@/app/admin/actions";
import { formatMoney } from "@/lib/format";
import { slotDayName, slotRange } from "@/lib/delivery-slots";

const POLL_MS = 15000;
const STATE_KEY = "trait-order-alerts", SOUND_KEY = "trait-order-sound";
type Saved = { cursor: OrderAlertCursor; alerts: OrderAlert[] };

// Unseen alerts (shared with the Orders tab badge) and whether the beep can play.
const none: OrderAlert[] = [];
let shared: OrderAlert[] = none, soundOn = true;
const listeners = new Set<() => void>();
function publish(next: OrderAlert[]) { shared = next; listeners.forEach(l => l()); }
function publishSound(on: boolean) { soundOn = on; listeners.forEach(l => l()); }
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }

function load(): Saved | null { try { const v = JSON.parse(sessionStorage.getItem(STATE_KEY) ?? "null"); return v && Array.isArray(v.alerts) ? v : null; } catch { return null; } }
function save(value: Saved) { try { sessionStorage.setItem(STATE_KEY, JSON.stringify(value)); } catch { /* Alerts still work for this page. */ } }
function wantsSound() { try { return localStorage.getItem(SOUND_KEY) === "on"; } catch { return false; } }

function summary(o: OrderAlert) {
 const method = o.fulfillment_method === "HOME_DELIVERY" ? "Delivery" : "Pickup";
 const slot = o.slot ? slotDayName(o.slot.date) + " " + o.slot.name + " " + slotRange(o.slot.startsAt, o.slot.endsAt) : "";
 return [o.order_number, formatMoney(Number(o.total_paise)), method, slot].filter(Boolean).join(" · ");
}

/** Count of new orders not yet opened or dismissed; shown on the Orders tab. */
export function OrderAlertCount() {
 const count = useSyncExternalStore(subscribe, () => shared.length, () => 0);
 return count ? <span className="order-alert-count" aria-label={count + " new"}>{count}</span> : null;
}

/** ADMIN/OWNER: polls every 15 s for orders newer than the last seen; each one stays until opened or dismissed. */
export function OrderAlerts({ base }: { base: string }) {
 const alerts = useSyncExternalStore(subscribe, () => shared, () => none);
 const soundReady = useSyncExternalStore(subscribe, () => soundOn, () => true);
 const cursor = useRef<OrderAlertCursor>(null), started = useRef(false), audio = useRef<AudioContext | null>(null);

 const update = useCallback((next: OrderAlert[]) => { publish(next); save({ cursor: cursor.current, alerts: next }); }, []);

 const beep = useCallback((times: number) => {
  const ctx = audio.current;
  if (!ctx || ctx.state !== "running") return;
  for (let i = 0; i < times; i++) {
   const at = ctx.currentTime + i * 0.45, osc = ctx.createOscillator(), gain = ctx.createGain();
   osc.type = "sine"; osc.frequency.value = 880;
   gain.gain.setValueAtTime(0.0001, at); gain.gain.exponentialRampToValueAtTime(0.4, at + 0.02); gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.3);
   osc.connect(gain).connect(ctx.destination); osc.start(at); osc.stop(at + 0.32);
  }
 }, []);

 const enableSound = useCallback(async () => {
  try {
   audio.current ??= new AudioContext();
   await audio.current.resume();
   localStorage.setItem(SOUND_KEY, "on");
  } catch { /* Sound unavailable in this browser. */ }
  publishSound(audio.current?.state === "running");
  beep(1);
  if ("Notification" in window && Notification.permission === "default") void Notification.requestPermission().catch(() => undefined);
 }, [beep]);

 // Restore this tab's alerts; browsers keep audio blocked until the person interacts, so re-arm on the first tap.
 useEffect(() => {
  const saved = load();
  if (saved) { cursor.current = saved.cursor; publish(saved.alerts); }
  if (!wantsSound()) { publishSound(false); return; }
  try { audio.current = new AudioContext(); } catch { publishSound(false); return; }
  const ctx = audio.current, sync = () => publishSound(ctx.state === "running");
  sync(); ctx.addEventListener("statechange", sync);
  const arm = () => void ctx.resume().catch(() => undefined);
  window.addEventListener("pointerdown", arm, { once: true }); window.addEventListener("keydown", arm, { once: true });
  return () => { ctx.removeEventListener("statechange", sync); window.removeEventListener("pointerdown", arm); window.removeEventListener("keydown", arm); };
 }, []);

 useEffect(() => {
  let busy = false, disposed = false;
  const poll = async () => {
   if (busy) return; busy = true;
   try {
    const result = await pollOrderAlerts(cursor.current);
    if (!result || disposed) return;
    const first = !started.current && !cursor.current; started.current = true;
    cursor.current = result.cursor;
    const fresh = first ? [] : result.orders.filter(o => !shared.some(a => a.id === o.id));
    if (!fresh.length) { save({ cursor: cursor.current, alerts: shared }); return; }
    update([...shared, ...fresh]);
    beep(fresh.length);
    if (document.visibilityState === "hidden" && "Notification" in window && Notification.permission === "granted") {
     for (const o of fresh) {
      try {
       const n = new Notification("New order " + o.order_number, { body: summary(o).split(" · ").slice(1).join(" · "), tag: "order-" + o.id });
       n.onclick = () => { window.focus(); window.location.assign(base + "/orders?store=" + o.store_id + "&order=" + o.id); n.close(); };
      } catch { /* Some mobile browsers only notify from a service worker. */ }
     }
    }
   } finally { busy = false; }
  };
  void poll();
  const timer = window.setInterval(() => void poll(), POLL_MS);
  return () => { disposed = true; window.clearInterval(timer); };
 }, [base, beep, update]);

 const dismiss = (id: string) => update(shared.filter(a => a.id !== id));
 if (!alerts.length && soundReady) return null;
 return <div className="order-alerts" aria-live="polite">
  {!soundReady && <button type="button" className="admin-button secondary order-alerts-sound" onClick={() => void enableSound()}>🔔 Enable order sound</button>}
  {alerts.map(o => <div key={o.id} className="order-alert" role="status">
   <Link href={base + "/orders?store=" + o.store_id + "&order=" + o.id} onClick={() => dismiss(o.id)}>🔔 New order {summary(o)}</Link>
   <button type="button" aria-label={"Dismiss " + o.order_number} onClick={() => dismiss(o.id)}>×</button>
  </div>)}
 </div>;
}
