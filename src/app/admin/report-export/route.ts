import type { NextRequest } from "next/server";
import { requireStaff, staffRpc } from "@/lib/admin/server";
import { dailyTable, periodLabel, rangeLabels, reportTabs, resolvePeriod, summaryRows, tabLabels, tabTables, type Cell, type ColumnKind, type ReportTab, type ReportTable, type SalesReport } from "@/lib/admin/sales-report";
import { formatDateTimeIST } from "@/lib/format";
import { buildXlsx, type XlsxCell, type XlsxRow, type XlsxSheet } from "@/lib/xlsx";

// Excel serial day for a YYYY-MM-DD calendar date (days since 1899-12-30).
const serial = (day: string) => Math.round(Date.parse(day + "T00:00:00Z") / 86400000) + 25569;
function cell(value: Cell, kind: ColumnKind): XlsxCell {
 if (value === null || typeof value === "string" && kind !== "day" && kind !== "time") return value;
 if (kind === "day") return /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? { value: serial(String(value)), format: "date" } : String(value);
 if (kind === "time") return formatDateTimeIST(String(value));
 if (typeof value === "string") return value;
 if (kind === "money") return { value: value / 100, format: "money" };
 if (kind === "kg") return { value: value / 1000, format: "kg" };
 if (kind === "pct") return { value, format: "pct" };
 if (kind === "int") return { value, format: "int" };
 return value;
}
const tableRows = (t: ReportTable): XlsxRow[] => [{ cells: [t.title], bold: true }, { cells: t.columns.map(c => c.label + (c.kind === "money" ? " (₹)" : "")), bold: true },
 ...t.rows.map(r => ({ cells: r.map((v, i) => cell(v, t.columns[i].kind)) })), ...(t.total ? [{ cells: t.total.map((v, i) => cell(v, t.columns[i].kind)), bold: true }] : [])];

/** The Reports view the staff member is looking at (period, store, tab) as an .xlsx file. ADMIN/OWNER only; the database checks again. */
export async function GET(request: NextRequest) {
 let staff;
 try { staff = await requireStaff("reports"); } catch { return new Response("Not permitted.", { status: 403 }); }
 const query = request.nextUrl.searchParams;
 const store = staff.context.stores.find(s => s.id === query.get("store")) ?? staff.context.stores[0];
 if (!store) return new Response("No accessible stores.", { status: 404 });
 const period = resolvePeriod(query.get("range") ?? undefined, query.get("from") ?? undefined, query.get("until") ?? undefined);
 if (period.error) return new Response(period.error, { status: 400 });
 const tab: ReportTab = reportTabs.includes(query.get("tab") as ReportTab) ? query.get("tab") as ReportTab : "products";
 let report: SalesReport;
 try { report = await staffRpc<SalesReport>(staff.token, "sales_report", { target_store: store.id, from_day: period.from, until_day: period.until }); }
 catch { return new Response("Report unavailable.", { status: 502 }); }
 const sheets: XlsxSheet[] = [
  { name: "Summary", rows: [{ cells: ["Sales report"], bold: true }, { cells: ["Store", store.name] }, { cells: ["Period", rangeLabels[period.range] + ": " + periodLabel(period) + " (India time, inclusive)"] }, { cells: [] },
   { cells: ["Measure", "Value"], bold: true }, ...summaryRows(report).map(([label, value, kind]) => ({ cells: [label, cell(value, kind)] }))] },
  { name: "Daily trend", rows: tableRows(dailyTable(report)) },
  ...tabTables(report, tab).map(t => ({ name: t.title === tabLabels[tab] ? tabLabels[tab] : t.title.replace("Day-end cash ", "Cash "), rows: tableRows(t) })),
 ];
 const name = "trait-report-" + period.from + (period.until === period.from ? "" : "-to-" + period.until) + "-" + tab + ".xlsx";
 return new Response(new Uint8Array(buildXlsx(sheets)), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": "attachment; filename=\"" + name + "\"", "Cache-Control": "no-store" } });
}
