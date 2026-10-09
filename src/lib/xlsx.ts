import "server-only";
import { deflateRawSync } from "node:zlib";
// Minimal .xlsx writer (Office Open XML in a zip): inline strings, numbers with a few formats, bold header rows. No dependencies.
export type XlsxFormat = "money" | "pct" | "date" | "kg" | "int";
export type XlsxCell = string | number | null | { value: number; format: XlsxFormat };
export type XlsxRow = { cells: XlsxCell[]; bold?: boolean };
export type XlsxSheet = { name: string; rows: XlsxRow[] };

const styleIndex: Record<XlsxFormat, number> = { money: 2, pct: 3, date: 4, kg: 5, int: 6 };
const escape = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
const column = (i: number): string => (i >= 26 ? column(Math.floor(i / 26) - 1) : "") + String.fromCharCode(65 + (i % 26));

function sheetXml(sheet: XlsxSheet) {
 const widths: number[] = [];
 const rows = sheet.rows.map((row, r) => "<row r=\"" + (r + 1) + "\">" + row.cells.map((cell, c) => {
  const ref = column(c) + (r + 1);
  const text = cell === null ? "" : typeof cell === "object" ? String(cell.value) : String(cell);
  widths[c] = Math.max(widths[c] ?? 8, Math.min(60, text.length + 3));
  if (cell === null) return "";
  if (typeof cell === "string") return "<c r=\"" + ref + "\" t=\"inlineStr\"" + (row.bold ? " s=\"1\"" : "") + "><is><t xml:space=\"preserve\">" + escape(cell) + "</t></is></c>";
  const value = typeof cell === "number" ? cell : cell.value, style = typeof cell === "number" ? (row.bold ? 1 : 0) : styleIndex[cell.format] + (row.bold ? 6 : 0);
  return Number.isFinite(value) ? "<c r=\"" + ref + "\"" + (style ? " s=\"" + style + "\"" : "") + "><v>" + value + "</v></c>" : "";
 }).join("") + "</row>").join("");
 const cols = widths.length ? "<cols>" + widths.map((w, i) => "<col min=\"" + (i + 1) + "\" max=\"" + (i + 1) + "\" width=\"" + Math.max(w, 12) + "\" customWidth=\"1\"/>").join("") + "</cols>" : "";
 return "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">" + cols + "<sheetData>" + rows + "</sheetData></worksheet>";
}
// Styles: 0 normal, 1 bold, 2–6 formats (money, pct, date, kg, int), 8–12 the same formats in bold.
const formats = "<xf numFmtId=\"164\" fontId=\"0\" applyNumberFormat=\"1\"/><xf numFmtId=\"165\" fontId=\"0\" applyNumberFormat=\"1\"/><xf numFmtId=\"166\" fontId=\"0\" applyNumberFormat=\"1\"/><xf numFmtId=\"167\" fontId=\"0\" applyNumberFormat=\"1\"/><xf numFmtId=\"3\" fontId=\"0\" applyNumberFormat=\"1\"/>";
const styles = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><styleSheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">"
 + "<numFmts count=\"4\"><numFmt numFmtId=\"164\" formatCode=\"&quot;₹&quot;#,##0.00\"/><numFmt numFmtId=\"165\" formatCode=\"0.0%\"/><numFmt numFmtId=\"166\" formatCode=\"dd mmm yyyy\"/><numFmt numFmtId=\"167\" formatCode=\"0.000\"/></numFmts>"
 + "<fonts count=\"2\"><font><sz val=\"11\"/><name val=\"Calibri\"/></font><font><b/><sz val=\"11\"/><name val=\"Calibri\"/></font></fonts>"
 + "<fills count=\"2\"><fill><patternFill patternType=\"none\"/></fill><fill><patternFill patternType=\"gray125\"/></fill></fills><borders count=\"1\"><border/></borders>"
 + "<cellStyleXfs count=\"1\"><xf/></cellStyleXfs><cellXfs count=\"13\"><xf/><xf fontId=\"1\" applyFont=\"1\"/>" + formats + "<xf/>" + formats.replaceAll("fontId=\"0\"", "fontId=\"1\" applyFont=\"1\"") + "</cellXfs></styleSheet>";

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(data: Buffer) { let c = 0xffffffff; for (const b of data) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function zip(files: [string, string][]) {
 const parts: Buffer[] = [], central: Buffer[] = []; let offset = 0;
 for (const [name, text] of files) {
  const raw = Buffer.from(text, "utf8"), packed = deflateRawSync(raw), path = Buffer.from(name, "utf8"), crc = crc32(raw);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(path.length, 26);
  const entry = Buffer.alloc(46); entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(0x0800, 8); entry.writeUInt16LE(8, 10);
  entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(packed.length, 20); entry.writeUInt32LE(raw.length, 24); entry.writeUInt16LE(path.length, 28); entry.writeUInt32LE(offset, 42);
  parts.push(local, path, packed); central.push(entry, path); offset += 30 + path.length + packed.length;
 }
 const directory = Buffer.concat(central), end = Buffer.alloc(22);
 end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
 return Buffer.concat([...parts, directory, end]);
}
/** Sheet names: at most 31 characters, none of []:*?/\ and unique. */
export function buildXlsx(sheets: XlsxSheet[]): Buffer {
 const names = sheets.map((s, i) => (s.name.replace(/[[\]:*?/\\]/g, " ").slice(0, 28) || "Sheet") + (sheets.slice(0, i).some(o => o.name === s.name) ? " " + (i + 1) : ""));
 return zip([
  ["[Content_Types].xml", "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/><Override PartName=\"/xl/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml\"/>" + sheets.map((_, i) => "<Override PartName=\"/xl/worksheets/sheet" + (i + 1) + ".xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>").join("") + "</Types>"],
  ["_rels/.rels", "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/></Relationships>"],
  ["xl/workbook.xml", "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets>" + names.map((n, i) => "<sheet name=\"" + escape(n) + "\" sheetId=\"" + (i + 1) + "\" r:id=\"rId" + (i + 1) + "\"/>").join("") + "</sheets></workbook>"],
  ["xl/_rels/workbook.xml.rels", "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" + sheets.map((_, i) => "<Relationship Id=\"rId" + (i + 1) + "\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet" + (i + 1) + ".xml\"/>").join("") + "<Relationship Id=\"rId" + (sheets.length + 1) + "\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/></Relationships>"],
  ["xl/styles.xml", styles],
  ...sheets.map((s, i): [string, string] => ["xl/worksheets/sheet" + (i + 1) + ".xml", sheetXml(s)]),
 ]);
}
