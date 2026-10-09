import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {inflateRawSync} from "node:zlib";
import ts from "typescript";
const load=async(path,strip=[])=>{let source=readFileSync(new URL(path,import.meta.url),"utf8");for(const s of strip)source=source.replace(s,"");return import("data:text/javascript;base64,"+Buffer.from(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText).toString("base64"));};
const report=await load("../src/lib/admin/sales-report.ts");
const {buildXlsx}=await load("../src/lib/xlsx.ts",['import "server-only";']);

test("report presets use India calendar days, inclusive, weeks from Monday",()=>{
 // 2026-10-09 20:00 UTC is already Saturday 10 Oct in India.
 const now=new Date("2026-10-09T20:00:00Z");
 assert.equal(report.istToday(now),"2026-10-10");
 assert.deepEqual(report.resolvePeriod("today",undefined,undefined,now),{range:"today",from:"2026-10-10",until:"2026-10-10"});
 assert.deepEqual(report.resolvePeriod("yesterday",undefined,undefined,now),{range:"yesterday",from:"2026-10-09",until:"2026-10-09"});
 assert.deepEqual(report.resolvePeriod("week",undefined,undefined,now),{range:"week",from:"2026-10-05",until:"2026-10-10"});
 assert.deepEqual(report.resolvePeriod("month",undefined,undefined,now),{range:"month",from:"2026-10-01",until:"2026-10-10"});
 assert.deepEqual(report.resolvePeriod("last-month",undefined,undefined,now),{range:"last-month",from:"2026-09-01",until:"2026-09-30"});
 assert.deepEqual(report.resolvePeriod("last-month",undefined,undefined,new Date("2026-01-15T06:00:00Z")),{range:"last-month",from:"2025-12-01",until:"2025-12-31"});
 assert.deepEqual(report.resolvePeriod("week",undefined,undefined,new Date("2026-10-05T06:00:00Z")).from,"2026-10-05");
 assert.deepEqual(report.resolvePeriod("custom","2026-02-01","2026-02-28",now),{range:"custom",from:"2026-02-01",until:"2026-02-28"});
 for(const [from,until] of [["2026-02-30","2026-03-01"],["2026-03-02","2026-03-01"],["2025-01-01","2026-01-02"],["",""],["2026-1-1","2026-01-02"]])
  assert.ok(report.resolvePeriod("custom",from,until,now).error,from+" to "+until);
 assert.equal(report.resolvePeriod("custom","2025-01-01","2026-01-01",now).error,undefined,"366 days inclusive is allowed");
 assert.equal(report.resolvePeriod("nonsense",undefined,undefined,now).range,"today");
 assert.equal(report.periodLabel({from:"2026-10-01",until:"2026-10-09"}),"1 Oct 2026 – 9 Oct 2026");
});

const sample={from:"2026-10-01",until:"2026-10-02",summary:{orders:4,revenuePaise:100000,discountPaise:5000,deliveryFeePaise:6000,cancelled:1,cancelledPaise:20000},
 daily:[{day:"2026-10-01",orders:3,revenuePaise:70000},{day:"2026-10-02",orders:1,revenuePaise:30000}],
 products:[{name:"Seer Fish",category:"Fish",grams:1500,packs:0,trays:false,orders:2,revenuePaise:75000},{name:"Eggs",category:"Eggs",grams:0,packs:3,trays:true,orders:2,revenuePaise:25000}],
 categories:[],payments:[{method:"CASH",orders:3,collectedPaise:50000,pendingPaise:20000,refundedPaise:0},{method:"UPI",orders:1,collectedPaise:30000,pendingPaise:0,refundedPaise:1000}],
 fulfilment:[{method:"HOME_DELIVERY",orders:3,revenuePaise:80000,deliveryFeePaise:6000},{method:"STORE_PICKUP",orders:1,revenuePaise:20000,deliveryFeePaise:0}],
 coupons:[{code:null,title:"Auto",uses:1,discountPaise:1000,revenuePaise:9000}],
 cancellations:[{orderNumber:"TFM-000009",placedAt:"2026-10-01T05:00:00Z",cancelledAt:"2026-10-01T06:00:00Z",amountPaise:20000,reason:"Out of stock",by:"Anil",role:"OWNER"}],
 cash:[{day:"2026-10-01",staff:"Anil",collections:2,receivedPaise:40000,refundedPaise:0},{day:"2026-10-01",staff:"Ravi",collections:1,receivedPaise:10000,refundedPaise:2000}]};

test("report tables: summary, shares, quantities, totals and day-end cash per day and staff",()=>{
 assert.deepEqual(report.summaryRows(sample).map(r=>r[1]),[4,100000,25000,5000,6000,1,20000]);
 const [products]=report.tabTables(sample,"products");
 assert.deepEqual(products.rows[0],["Seer Fish","Fish",1500,null,2,75000,0.75]);
 assert.deepEqual(products.rows[1],["Eggs","Eggs",null,3,2,25000,0.25]);
 assert.deepEqual(products.total,["Total",null,1500,3,null,100000,1]);
 assert.deepEqual(report.tabTables(sample,"payments")[0].total,["Total",4,80000,20000,1000]);
 assert.deepEqual(report.tabTables(sample,"fulfilment")[0].rows.map(r=>[r[0],r[3],r[5]]),[["Delivery",26667,0.8],["Pickup",20000,0.2]]);
 assert.equal(report.tabTables(sample,"coupons")[0].rows[0][0],"Automatic");
 assert.equal(report.tabTables(sample,"cancellations")[0].rows[0][5],"Anil (Owner)");
 const [byDay,byStaff]=report.tabTables(sample,"cash");
 assert.deepEqual(byDay.rows,[["2026-10-01",3,50000,2000,48000]]);
 assert.deepEqual(byStaff.rows.map(r=>[r[1],r[5]]),[["Anil",40000],["Ravi",8000]]);
 assert.deepEqual(report.dailyTable(sample).total,["Total",4,100000]);
 for(const tab of report.reportTabs)for(const t of report.tabTables(sample,tab))for(const row of [...t.rows,...(t.total?[t.total]:[])])assert.equal(row.length,t.columns.length,tab+" "+t.title);
});

/** Reads a zip's central directory and inflates every entry, checking sizes. */
function unzip(buffer){
 const end=buffer.lastIndexOf(Buffer.from([0x50,0x4b,5,6])),count=buffer.readUInt16LE(end+10);let at=buffer.readUInt32LE(end+16);const files={};
 for(let i=0;i<count;i++){
  const size=buffer.readUInt32LE(at+20),raw=buffer.readUInt32LE(at+24),nameLength=buffer.readUInt16LE(at+28),offset=buffer.readUInt32LE(at+42),name=buffer.subarray(at+46,at+46+nameLength).toString();
  const start=offset+30+buffer.readUInt16LE(offset+26),text=inflateRawSync(buffer.subarray(start,start+size));
  assert.equal(text.length,raw,name);files[name]=text.toString();at+=46+nameLength;
 }
 return files;
}
test("xlsx export is a valid workbook with typed numbers, escaped text and safe sheet names",()=>{
 const files=unzip(buildXlsx([{name:"Summary",rows:[{cells:["Measure","Value"],bold:true},{cells:["Revenue",{value:1234.5,format:"money"}]},{cells:["A & <B>",null,7]}]},{name:"By product/category: [x]",rows:[]}]));
 assert.deepEqual(Object.keys(files).sort(),["[Content_Types].xml","_rels/.rels","xl/_rels/workbook.xml.rels","xl/styles.xml","xl/workbook.xml","xl/worksheets/sheet1.xml","xl/worksheets/sheet2.xml"]);
 assert.match(files["xl/worksheets/sheet1.xml"],/<c r="B2" s="2"><v>1234.5<\/v><\/c>/);
 assert.match(files["xl/worksheets/sheet1.xml"],/A &amp; &lt;B&gt;/);
 assert.match(files["xl/worksheets/sheet1.xml"],/<c r="C3"><v>7<\/v><\/c>/);
 assert.match(files["xl/workbook.xml"],/name="By product category   x "/);
 const xfs=files["xl/styles.xml"].match(/<cellXfs count="(\d+)">(.*)<\/cellXfs>/);
 assert.equal((xfs[2].match(/<xf[ />]/g)||[]).length,Number(xfs[1]));
});
