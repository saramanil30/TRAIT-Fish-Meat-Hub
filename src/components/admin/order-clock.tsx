"use client";
import { useSyncExternalStore } from "react";

// One shared clock, ticking every 15 s, for every order row on the page.
const TICK_MS = 15000;
const listeners = new Set<() => void>();
let timer: number | undefined;
function subscribe(listener: () => void) {
 listeners.add(listener);
 timer ??= window.setInterval(() => listeners.forEach(l => l()), TICK_MS);
 return () => { listeners.delete(listener); if (!listeners.size) { window.clearInterval(timer); timer = undefined; } };
}
const tick = () => Math.floor(Date.now() / TICK_MS);

/** Minutes a new order has waited to be confirmed. */
export function waitMinutes(createdAt: string, now: number) { return Math.max(0, Math.floor((now - Date.parse(createdAt)) / 60000)); }
/** A slot order is late once its slot has started and it still hasn't left the shop (pickup: isn't ready). */
export function isLate(status: string, pickup: boolean, slot: { date: string; startsAt: string } | null | undefined, now: number) {
 if (!slot) return false;
 const waiting = pickup ? ["PLACED", "CONFIRMED", "PREPARING"] : ["PLACED", "CONFIRMED", "PREPARING", "READY"];
 return waiting.includes(status) && now >= Date.parse(slot.date + "T" + slot.startsAt + ":00+05:30");
}

/** "Waiting 3 min" on new orders (amber from 2 min, red from 5) and "Late" on slot orders past their start. Client-only, so no server/client clock mismatch. */
export function OrderClock({ createdAt, status, pickup, slot }: { createdAt: string; status: string; pickup: boolean; slot?: { date: string; startsAt: string } | null }) {
 const step = useSyncExternalStore(subscribe, tick, () => null);
 if (step === null) return null;
 const now = step * TICK_MS, late = isLate(status, pickup, slot, now);
 const wait = status === "PLACED" ? waitMinutes(createdAt, now) : null;
 return <>
  {wait !== null && <span className={"ord-wait" + (wait >= 5 ? " is-overdue" : wait >= 2 ? " is-slow" : "")}>Waiting {wait < 1 ? "<1" : wait < 60 ? wait : Math.floor(wait / 60) + " h " + (wait % 60)} min</span>}
  {late && <span className="ord-late">Late</span>}
 </>;
}
