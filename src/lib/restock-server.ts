import "server-only";
import { claimRestockPushes, logCheckoutFailure } from "./checkout-server";
import { pushConfigured, sendPush } from "./web-push";
import { restockPath } from "./restock";

/** Sends the browser pushes due for products that are available again. Each is claimed once, so a failed send is
 *  not retried (WhatsApp from Admin is the fallback). Never throws: call it after a stock or availability change. */
export async function dispatchRestockPushes() {
 if (!pushConfigured()) return;
 try {
  const due = await claimRestockPushes();
  let sent = 0, gone = 0, failed = 0;
  for (let i = 0; i < due.length; i += 20) {
   const results = await Promise.allSettled(due.slice(i, i + 20).map(p => sendPush(p.subscription, { title: p.productName + " is back at TRAIT!", body: "Tap to order before it sells out.", url: restockPath(p.productName), tag: "restock-" + p.productId })));
   for (const r of results) if (r.status === "fulfilled" && r.value >= 200 && r.value < 300) sent++; else if (r.status === "fulfilled" && (r.value === 404 || r.value === 410)) gone++; else failed++;
  }
  if (due.length) console.info("[restock] pushes", { sent, gone, failed });
 } catch (cause) { logCheckoutFailure("restock push", cause); }
}
