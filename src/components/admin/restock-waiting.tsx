import { headers } from "next/headers";
import { staffRpc } from "@/lib/admin/server";
import { formatDateTimeIST } from "@/lib/format";
import { restockMessage } from "@/lib/restock";
import { whatsappLink } from "@/lib/whatsapp";
import { NotifyOnWhatsApp } from "./restock-notify";
type Waiting = { productId: string; productName: string; available: boolean; waiting: number; requests: { id: string; mobile: string; requestedAt: string; expiresAt: string; pushed: boolean; notifiedAt: string | null }[] };

/** Prices & Availability (ADMIN/OWNER): "Notify me" requests by product, with a WhatsApp message per number. */
export async function RestockWaiting({ token, store }: { token: string; store: string }) {
 // Null until the restock alerts migration is applied; the prices table still works.
 const list = await staffRpc<Waiting[]>(token, "restock_waiting", { target_store: store }).catch(() => null);
 if (!list) return <section className="restock-waiting"><h2>Waiting for restock</h2><p className="admin-muted">Unavailable. Apply the restock alerts migration (20261110000000_restock_alerts.sql), then reload.</p></section>;
 const host = (await headers()).get("host");
 const site = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || (host ? (/^(localhost|127\.)/.test(host) ? "http://" : "https://") + host : "");
 return <section className="restock-waiting" aria-labelledby="restock-waiting-title">
  <h2 id="restock-waiting-title">Waiting for restock</h2>
  <p className="admin-muted">Customers who tapped “Notify me” on a sold-out product (requests last 7 days). Browser alerts go out automatically when you make a product available; send WhatsApp yourself and each number is marked notified.</p>
  {!list.length ? <p className="admin-empty">No one is waiting right now.</p> : list.map(p => <details key={p.productId} className="restock-product" open={p.available && p.waiting > 0}>
   <summary><strong>{p.productName}</strong> <span className="admin-badge">{p.waiting} waiting</span> <span className={p.available ? "restock-state is-back" : "restock-state"}>{p.available ? "Available again" : "Still sold out"}</span></summary>
   {!p.available && <p className="admin-muted">Make it available below first; then message each number.</p>}
   <ul className="restock-requests">{p.requests.map(r => <li key={r.id}>
    <div><a href={"tel:" + r.mobile}>{r.mobile}</a><small>Asked {formatDateTimeIST(r.requestedAt)}{r.pushed ? " · browser alert sent" : ""}</small></div>
    <NotifyOnWhatsApp id={r.id} href={whatsappLink(r.mobile, restockMessage(p.productName, site))} notifiedAt={r.notifiedAt} disabled={!p.available} />
   </li>)}</ul>
  </details>)}
 </section>;
}
