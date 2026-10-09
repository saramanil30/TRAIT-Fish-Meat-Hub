import Link from "next/link";
import { staffRpc } from "@/lib/admin/server";
import { formatDateTimeIST, formatMoney } from "@/lib/format";
import { dailyTable, dayLabel, periodLabel, rangeLabels, reportRanges, reportTabs, resolvePeriod, summaryRows, tabLabels, tabTables, type Cell, type ColumnKind, type ReportTab, type ReportTable, type SalesReport } from "@/lib/admin/sales-report";

const kg = (grams: number) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 }).format(grams / 1000);
function show(value: Cell, kind: ColumnKind) {
 if (value === null) return "";
 if (typeof value === "string") return kind === "day" && /^\d{4}-/.test(value) ? dayLabel(value) : kind === "time" ? formatDateTimeIST(value) : value;
 if (kind === "money") return formatMoney(value);
 if (kind === "kg") return kg(value);
 if (kind === "pct") return (value * 100).toFixed(1) + "%";
 return new Intl.NumberFormat("en-IN").format(value);
}
const numeric = (kind: ColumnKind) => kind !== "text" && kind !== "day" && kind !== "time";
function Table({ table, empty }: { table: ReportTable; empty: string }) {
 if (!table.rows.length) return <section className="rep-table"><h3>{table.title}</h3><p className="rep-muted">{empty}</p></section>;
 return <section className="rep-table"><h3>{table.title}</h3><div className="rep-scroll" tabIndex={0} role="region" aria-label={table.title}><table>
  <thead><tr>{table.columns.map(c => <th key={c.label} scope="col" className={numeric(c.kind) ? "num" : undefined}>{c.label}</th>)}</tr></thead>
  <tbody>{table.rows.map((r, i) => <tr key={i}>{r.map((v, j) => j === 0 ? <th key={j} scope="row">{show(v, table.columns[j].kind)}</th> : <td key={j} className={numeric(table.columns[j].kind) ? "num" : undefined}>{show(v, table.columns[j].kind)}</td>)}</tr>)}</tbody>
  {table.total && <tfoot><tr>{table.total.map((v, j) => j === 0 ? <th key={j} scope="row">{show(v, table.columns[j].kind)}</th> : <td key={j} className={numeric(table.columns[j].kind) ? "num" : undefined}>{show(v, table.columns[j].kind)}</td>)}</tr></tfoot>}
 </table></div></section>;
}
/** One measure per chart (no dual axis): bars on a shared day axis, a tooltip per bar, labels in ink. */
function Bars({ title, days, values, format }: { title: string; days: string[]; values: number[]; format: (n: number) => string }) {
 const max = Math.max(...values, 0), best = values.indexOf(max), every = Math.ceil(days.length / 6);
 return <figure className="rep-chart" aria-label={title + ": highest " + (max ? format(max) + " on " + dayLabel(days[best]) : "none")}>
  <figcaption>{title}</figcaption>
  <div className="rep-plot" role="img" aria-hidden="true">
   <span className="rep-axis-top">{format(max)}</span>
   <div className="rep-bars" style={{ gap: days.length > 60 ? 1 : 2 }}>{values.map((v, i) => <div key={days[i]} className="rep-bar" data-tip={dayLabel(days[i]) + " · " + format(v)} title={dayLabel(days[i]) + ": " + format(v)}><span style={{ height: max ? Math.max(v ? 2 : 0, v / max * 100) + "%" : 0 }} /></div>)}</div>
  </div>
  <div className="rep-days" aria-hidden="true">{days.map((d, i) => <span key={d}>{(i % every === 0 && days.length - 1 - i >= every / 2) || i === days.length - 1 ? dayLabel(d).replace(/ \d{4}$/, "") : ""}</span>)}</div>
 </figure>;
}
const emptyText: Record<ReportTab, string> = { products: "No items sold in this period.", categories: "No items sold in this period.", payments: "No payments for orders in this period.", fulfilment: "No orders in this period.", coupons: "No coupons used in this period.", cancellations: "No cancellations in this period.", cash: "No cash collected or refunded in this period." };
const tabNotes: Partial<Record<ReportTab, string>> = { products: "Item sales are before order discounts; share is of all item sales. Cancelled orders are excluded.", categories: "Item sales are before order discounts. Cancelled orders are excluded.", payments: "Latest payment of each order placed in this period.", coupons: "Orders that used an offer; cancelled orders are excluded.", cancellations: "Orders placed in this period that were cancelled.", cash: "Cash taken and cash refunds handed over during this period, by the staff member who recorded them." };

export async function BusinessReport({ token, store, base, range, fromDate, untilDate, tab: requested }: { token: string; store?: string; base: string; range?: string; fromDate?: string; untilDate?: string; tab?: string }) {
 if (!store) return <p>No accessible stores.</p>;
 const period = resolvePeriod(range, fromDate, untilDate);
 const tab: ReportTab = reportTabs.includes(requested as ReportTab) ? requested as ReportTab : "products";
 // Custom dates travel only with the custom range, so presets stay relative to today.
 const query = (over: { range?: string; tab?: string } = {}) => { const r = over.range ?? period.range, q = new URLSearchParams({ store, range: r }); if (r === "custom") { q.set("from", period.from); q.set("until", period.until); } q.set("tab", over.tab ?? tab); return "?" + q; };
 let report: SalesReport;
 try { report = await staffRpc<SalesReport>(token, "sales_report", { target_store: store, from_day: period.from, until_day: period.until }); }
 catch { return <p role="alert">Reports are unavailable right now. Try again in a minute.</p>; }
 const days = report.daily.map(d => d.day);
 return <div className="rep">
  <nav className="rep-ranges" aria-label="Report period">{reportRanges.filter(r => r !== "custom").map(r => <Link key={r} href={base + query({ range: r })} aria-current={period.range === r ? "page" : undefined}>{rangeLabels[r]}</Link>)}</nav>
  <form method="get" action={base} className="rep-custom">
   <input type="hidden" name="store" value={store} /><input type="hidden" name="range" value="custom" /><input type="hidden" name="tab" value={tab} />
   <label>From<input type="date" name="from" required defaultValue={period.from} /></label>
   <label>To<input type="date" name="until" required defaultValue={period.until} /></label>
   <button className="admin-button secondary">Show custom range</button>
  </form>
  {period.error && <p role="alert">{period.error}</p>}
  <div className="rep-heading"><p><strong>{rangeLabels[period.range]}</strong> · {periodLabel(period)}</p><a className="admin-button rep-export" href={"/admin/report-export" + query()} download>Export to Excel</a></div>
  <dl className="rep-cards">{summaryRows(report).filter(([label]) => label !== "Cancelled value").map(([label, value, kind]) => <div key={label}><dt>{label === "Cancelled orders" ? "Cancelled" : label.replace(" (excludes cancelled)", "")}</dt><dd>{show(value, kind)}</dd>
   {label === "Revenue (excludes cancelled)" && <small>Excludes cancelled</small>}{label === "Cancelled orders" && <small>{formatMoney(Number(report.summary.cancelledPaise))}</small>}</div>)}</dl>
  {days.length > 1 ? <section className="rep-trend" aria-labelledby="rep-trend"><h2 id="rep-trend">Daily sales</h2>
   <div className="rep-charts"><Bars title="Revenue" days={days} values={report.daily.map(d => Number(d.revenuePaise))} format={formatMoney} /><Bars title="Orders" days={days} values={report.daily.map(d => Number(d.orders))} format={n => String(n)} /></div>
   <details className="rep-details"><summary>Show daily table</summary><Table table={dailyTable(report)} empty="No orders." /></details>
  </section> : <p className="rep-muted">Choose a period longer than one day to see the daily trend.</p>}
  <nav className="rep-tabs" aria-label="Report sections">{reportTabs.map(t => <Link key={t} href={base + query({ tab: t })} aria-current={t === tab ? "page" : undefined}>{tabLabels[t]}</Link>)}</nav>
  {tabNotes[tab] && <p className="rep-muted">{tabNotes[tab]}</p>}
  {tabTables(report, tab).map(t => <Table key={t.title} table={t} empty={emptyText[tab]} />)}
 </div>;
}
