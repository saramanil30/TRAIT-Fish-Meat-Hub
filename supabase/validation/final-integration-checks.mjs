import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";
const moduleURL=s=>"data:text/javascript;base64,"+Buffer.from(ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText).toString("base64");
export async function validate({db,as,value,q,id,denied,payload}){
 for(const name of ["20260927000000_application_integration","20260927010000_staff_reporting_integration","20260928000000_production_storefront"])await db.exec(readFileSync(new URL("../migrations/"+name+".sql",import.meta.url),"utf8"));
 const info=await as(null,()=>value("select api.storefront_info($1) as value",[id(10)]),"anon");
 assert.equal(info.name,"Main");assert.equal(info.areas.length,1);assert.equal(info.areas[0].feePaise,4000);
 assert.equal(JSON.stringify(info).includes("9876543210"),false);
 assert.equal(await as(null,()=>value("select api.storefront_info($1) as value",[id(999)]),"anon"),null);
 await db.query("UPDATE app.stores SET is_active=false WHERE id=$1",[id(11)]);
 assert.equal(await as(null,()=>value("select api.storefront_info($1) as value",[id(11)]),"anon"),null);
 await db.query("UPDATE app.stores SET is_active=true WHERE id=$1",[id(11)]);
 console.log("PASS active-only public store contact/delivery projection; no customer data");
 const all=await q("select id from app.orders where store_id=$1 order by created_at desc,id desc",[id(10)]);
 const seen=[];let before=null,cursor=null;
 while(true){const rows=await as(21,()=>value("select api.order_queue_page($1,2,$2,$3) as value",[id(10),before,cursor]));if(!rows.length)break;seen.push(...rows.map(r=>r.id));const last=rows.at(-1);before=last.created_at;cursor=last.id;}
 assert.deepEqual(seen,all.map(r=>r.id));
 await denied(23,"select api.order_queue_page($1)",[id(10)]);
 await denied(null,"select api.order_queue_page($1)",[id(10)],"anon");
 await assert.rejects(()=>as(21,()=>db.query("select api.order_queue_page($1,1,now(),null)",[id(10)])),e=>e.code==="22023");
 console.log("PASS complete queue pagination without omissions/duplicates; role/store/cursor checks");
 // Run the actual server adapter against PostgreSQL semantics in an isolated process.
 // Only transport and request headers are substituted; all quote/place SQL and role grants execute.
 await db.exec("CREATE ROLE checkout_test LOGIN; GRANT trait_checkout TO checkout_test");
 globalThis.__traitFinalSQL=async(strings,...args)=>as(null,async()=>{
  const query=strings.reduce((s,part,i)=>s+(i?'$'+i:'')+part,"");return (await db.query(query,args)).rows;
 },"checkout_test");
 const pg=moduleURL('export default function postgres(){return globalThis.__traitFinalSQL;}');
 const headers=moduleURL('export async function headers(){return new Headers();}');
 let source=readFileSync(new URL("../../src/lib/checkout-server.ts",import.meta.url),"utf8").replace('import "server-only";',"").replace('"postgres"',JSON.stringify(pg)).replace('"next/headers"',JSON.stringify(headers));
 const server=await import(moduleURL(source));
 process.env.TRAIT_CHECKOUT_DATABASE_URL="isolated-test";process.env.TRAIT_STORE_ID=id(10);process.env.TRAIT_CHECKOUT_ENVELOPE_KEY="a".repeat(64);process.env.TRAIT_TRACKING_EXPIRY_DAYS="7";
 for(const method of ["HOME_DELIVERY","STORE_PICKUP"]){
  const before=Number(await value("select count(*) as value from app.orders"));
  const quote=await server.quoteOrder(payload(method));
  assert.ok(quote.grandTotalPaise>0);const placed=await server.commitOrder(quote.envelope);
  assert.deepEqual(await server.commitOrder(quote.envelope),placed);
  assert.equal(Number(await value("select count(*) as value from app.orders")),before+1);
  const tracking=await as(null,()=>value("select api.track_order($1) as value",[placed.trackingToken]),"anon");
  assert.equal(tracking.status,"PLACED");assert.equal(tracking.paymentStatus,"PENDING");assert.equal(JSON.stringify(tracking).includes("9876543210"),false);
 }
 await db.exec("GRANT SELECT ON app.orders TO checkout_test");
 await assert.rejects(()=>server.quoteOrder(payload()),/least-privilege/);
 console.log("PASS real server quote/place/encryption/replay/tracking for delivery and pickup; overprivileged connection rejected");
 delete globalThis.__traitFinalSQL;
 const {validateInitialStore,provisionInitialStore}=await import("../../scripts/initial-store-data.mjs");
 assert.throws(()=>validateInitialStore(JSON.parse(readFileSync(new URL("../../config/initial-store.template.json",import.meta.url),"utf8"))));
 const approved={business:{slug:"bootstrap-test",displayName:"Test Only",legalName:null},store:{code:"main",name:"Test Store",addressLine1:"Test Street",city:"Test City",state:"Test State",pincode:"560001",contactMobile:"+919876543210",timezone:"Asia/Kolkata",openingHours:{mon:[{opens:"09:00",closes:"18:00"}]},deliveryEnabled:false,pickupEnabled:false},policy:{historyDays:7,cashLimitPaise:null,requirePaymentBeforeCompletion:true,maxOrderItems:20,maxOrderTotalPaise:100000}};
 const tag=async(strings,...args)=>(await db.query(strings.reduce((q,p,i)=>q+(i?'$'+i:'')+p,""),args)).rows;
 const adapter={begin:async callback=>{await db.exec("BEGIN");try{const result=await callback(tag);await db.exec("COMMIT");return result;}catch(e){await db.exec("ROLLBACK");throw e;}}};
 const setup=await provisionInitialStore(adapter,approved);assert.ok(setup.businessId&&setup.storeId);
 await assert.rejects(()=>provisionInitialStore(adapter,approved),/already exists/);
 await assert.rejects(()=>provisionInitialStore(adapter,{...approved,business:{...approved.business,slug:"rollback-test"},store:{...approved.store,openingHours:{bad:[]}}}));
 assert.equal(Number(await value("select count(*) as value from app.businesses where slug='rollback-test'")),0);
 console.log("PASS blank setup rejected, atomic approved-data bootstrap, audit, duplicate protection and rollback");
}
