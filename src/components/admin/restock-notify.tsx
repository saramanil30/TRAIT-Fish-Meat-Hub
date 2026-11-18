"use client";
import { useState, useTransition } from "react";
import { markRestockNotified } from "@/app/admin/restock-actions";
import { formatDateTimeIST } from "@/lib/format";
import { WHATSAPP_WINDOW } from "@/lib/whatsapp";

/** Opens WhatsApp with the back-in-stock message for one number and marks that request notified. */
export function NotifyOnWhatsApp({ id, href, notifiedAt, disabled }: { id: string; href: string; notifiedAt: string | null; disabled: boolean }) {
 const [done, setDone] = useState(notifiedAt);
 const [error, setError] = useState("");
 const [pending, start] = useTransition();
 if (done) return <span className="restock-done" role="status">Notified {formatDateTimeIST(done)}</span>;
 if (disabled) return <span className="admin-muted">Not back yet</span>;
 return <span className="restock-action"><a className="admin-button" href={href} target={WHATSAPP_WINDOW} rel="noopener noreferrer" aria-disabled={pending}
  onClick={() => start(async () => { const r = await markRestockNotified(id); if (r.notifiedAt) setDone(r.notifiedAt); else setError(r.error ?? "Could not mark notified."); })}>{pending ? "Marking…" : "Notify on WhatsApp"}</a>
  {error && <small role="alert">{error}</small>}</span>;
}
