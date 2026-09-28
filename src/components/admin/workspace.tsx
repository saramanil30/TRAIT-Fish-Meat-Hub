"use client";
import { useState } from "react";
import Link from "next/link";
import { Icon, type IconName } from "@/components/ui/icon";
import { canPreviewSection, sectionLabels, sections, type PreviewRole, type Section } from "@/lib/admin/presentation";
import { Orders } from "./orders";
import { Catalogue } from "./catalogue";
import { Employees } from "./employees";
import { Settings } from "./settings";
const icons: Record<Section, IconName> = { dashboard: "home", orders: "orders", catalogue: "fish", categories: "bag", prices: "cut", employees: "home", payments: "orders", reports: "orders", settings: "leaf" };
export function AdminWorkspace({ role, section }: { role: PreviewRole; section: Section }) {
 const [store, setStore] = useState("main");
 const [notice, setNotice] = useState("");
 const [menuOpen, setMenuOpen] = useState(false);
 const notify = (message = "Preview draft saved. Live records are unchanged.") => setNotice(message);
 return <div className="trait-admin admin-shell"><aside className={`admin-sidebar ${menuOpen ? "is-open" : ""}`}><Link href="/admin" className="admin-wordmark">TRAIT<span>FISH & MEAT HUB</span></Link><p className="admin-sidebar-label">STORE WORKSPACE</p><nav aria-label="Admin navigation">{sections.filter(s => s !== "settings" && canPreviewSection(role, s)).map(s => <Link key={s} href={`/admin/preview/${role}/${s}`} aria-current={section === s ? "page" : undefined}><Icon name={icons[s]} />{sectionLabels[s]}</Link>)}</nav><div className="admin-sidebar-bottom"><span className="admin-avatar">{role !== "employee" ? role === "admin" ? "A" : "O" : "E"}</span><div><strong>{role !== "employee" ? role === "admin" ? "Admin" : "Owner" : "Employee"} preview</strong><small>{role !== "employee" ? role === "admin" ? "Catalogue & administration" : "Business operations" : "Assigned-store orders"}</small></div></div>{role !== "employee" && <nav aria-label="Admin settings"><Link href={"/admin/preview/"+role+"/settings"} aria-current={section === "settings" ? "page" : undefined}><Icon name={icons.settings} />Settings</Link></nav>}<Link href="/admin/login" className="admin-exit">Exit preview</Link></aside>
 <div className="admin-main"><header className="admin-topbar"><button className="admin-menu admin-icon-button" aria-label="Toggle admin navigation" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>&#9776;</button><span>Workspace <span className="admin-muted">/ {sectionLabels[section]}</span></span><label className="admin-store"><Icon name="home" /><span className="sr-only">Store</span><select aria-label="Store" value={store} disabled={role === "employee"} onChange={e => setStore(e.target.value)}>{["dashboard", "orders", "payments"].includes(section) && role !== "employee" && <option value="all">All stores</option>}<option value="main">Main store</option>{role !== "employee" && <option value="branch">Sample branch</option>}</select></label><span className="admin-avatar small">{role !== "employee" ? role === "admin" ? "A" : "O" : "E"}</span></header>
 <div className="admin-preview-banner"><strong>PRESENTATION PREVIEW</strong><span>Synthetic data · Changes reset on navigation or reload · No live access</span></div>
 <div className="admin-content"><div className="admin-page-heading"><div><p className="admin-kicker">{role !== "employee" ? "FRESH FOOD. THOUGHTFUL OPERATIONS." : "MAIN STORE · ASSIGNED OPERATIONS"}</p><h1>{sectionLabels[section]}</h1><p className="admin-muted">{({ dashboard: "A fresh start. Here’s how your store is doing today.", orders: "Keep every order moving, from preparation to handover.", catalogue: "Thoughtfully prepared products, ready for your customers.", categories: "Organise your range and make good food easy to find.", prices: "Manage raw-weight pricing and availability for each store.", employees: "The people behind every fresh order.", payments: "Track collections, outstanding balances and payment evidence.", reports: "Sales, collections and outstanding balances remain distinct.", settings: "The details that keep your business running smoothly." })[section]}</p></div></div>
 {notice && <div className="admin-feedback" role="status">{notice}<button aria-label="Dismiss notification" onClick={() => setNotice("")}>×</button></div>}
 {["dashboard", "orders", "payments", "reports"].includes(section) && <Orders role={role} section={section === "reports" ? "dashboard" : section} store={store} notify={notify} />}
 {["catalogue", "categories", "prices"].includes(section) && <Catalogue role={role} section={section} store={store} notify={notify} />}
 {section === "employees" && <Employees notify={notify} />}
 {section === "settings" && <Settings key={store} notify={notify} />}
 <footer className="admin-footer"><strong>TRAIT</strong><span>Fresh food. Thoughtful operations.</span><span>Frontend preview · No live transactions</span></footer></div></div></div>;
}

