"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
export function Panel({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) { return <section className="admin-panel"><div className="admin-panel-heading"><h2>{title}</h2>{action}</div>{children}</section>; }
export function Badge({ children }: { children: string }) { return <span className={`admin-badge badge-${children.toLowerCase().replaceAll("_", "-").replaceAll(" ", "-")}`}>{children.replaceAll("_", " ")}</span>; }
export interface EditorField { name: string; label: string; value?: string | number; type?: string; options?: string[]; required?: boolean; min?: number; max?: number; step?: string; help?: string }
export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
 const ref = useRef<HTMLDialogElement>(null);
 useEffect(() => { const dialog = ref.current; const previous = document.activeElement as HTMLElement | null; dialog?.showModal(); return () => { dialog?.close(); previous?.focus(); }; }, []);
 return <dialog ref={ref} className="trait-admin admin-dialog" onCancel={onClose} aria-label={title}><div className="admin-panel-heading"><h2>{title}</h2><button className="admin-icon-button" onClick={onClose} aria-label="Close dialog">×</button></div>{children}</dialog>;
}
export function Editor({ title, fields, onSave, onClose, note }: { title: string; fields: EditorField[]; onSave: (values: Record<string, string>) => string | void; onClose: () => void; note?: string }) {
 const [error, setError] = useState("");
 return <Dialog title={title} onClose={onClose}><p className="admin-muted">{note ?? "Presentation draft only. Nothing is sent to the server."}</p><form onSubmit={event => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<string, string>; const message = onSave(values); if (message) setError(message); else onClose(); }}><div className="admin-form-grid">{fields.map(field => <label key={field.name}>{field.label}{field.options ? <select name={field.name} defaultValue={field.value}>{field.options.map(option => <option key={option}>{option}</option>)}</select> : field.type === "textarea" ? <textarea name={field.name} defaultValue={field.value} maxLength={1000} /> : <input name={field.name} type={field.type ?? "text"} defaultValue={field.value} required={field.required ?? true} min={field.min} max={field.max} step={field.step} maxLength={300} />}{field.help && <small>{field.help}</small>}</label>)}</div>{error && <p role="alert" className="admin-error">{error}</p>}<div className="admin-actions"><button className="admin-button" type="submit">Save preview draft</button><button className="admin-button secondary" type="button" onClick={onClose}>Cancel</button></div></form></Dialog>;
}
export type Edit = { title: string; fields: EditorField[]; save: (values: Record<string, string>) => string | void; note?: string };

