process.on('uncaughtException',e=>{console.error(e.message,e.code??'',e.where??'');process.exit(1);});
import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
import {createHash,randomBytes,randomUUID} from "node:crypto";
const {PGlite}=await import("../../node_modules/.staff-validation/node_modules/@electric-sql/pglite/dist/index.js");
const db=new PGlite();
const root=new URL("./",import.meta.url);
const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
const one=async(sql,args=[])=>(await q(sql,args))[0];
const value=async(sql,args=[])=>(await one(sql,args)).value;
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
let checks=0;
async function check(name,fn){await fn();checks++;console.log("PASS "+name);}
async function bad(sql,args=[],code){await assert.rejects(()=>db.query(sql,args),e=>!code||e.code===code);}
async function as(n,fn,role="authenticated"){
 await db.exec("SET ROLE "+role);
 await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[n?id(n):""]);
 try{return await fn();}finally{await db.exec("RESET ROLE");}
}
async function denied(n,sql,args=[],role="authenticated"){await assert.rejects(()=>as(n,()=>db.query(sql,args),role),e=>e.code==="42501");}
const checkout=(sql,args=[])=>as(null,()=>value(sql,args),"trait_checkout");
const verifier=(sql,args=[])=>as(null,()=>db.query(sql,args),"trait_payment_verifier");
await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY); CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;");
for(const [file,hash] of [
 ["20260923041240_phase_5b_1_foundation.sql","bfa3e52b3ae8095b84844743b0284fda"],
 ["20260926000000_staff_access.sql","d31acd506ee7729faf2eb7ee1aca3369"],
 ["20260926120000_phase_5b_2_catalogue.sql","7282a074b2ffb41c05376ff30a4ad7bb"],
 ["20260926140000_phase_5b_3_customers_delivery.sql","2675ac36595a07550e14747730547730"]]){
 const sql=readFileSync(new URL("../migrations/"+file,root),"utf8");
 assert.equal(createHash("md5").update(sql).digest("hex"),hash,"Prior migration unchanged");
 await db.exec(sql);
}
const snapshotSQL=readFileSync(new URL("schema-snapshot.sql",root),"utf8");
const before=(await one(snapshotSQL)).snapshot;
writeFileSync(new URL("core-baseline.json",root),JSON.stringify(before));
await db.exec(readFileSync(new URL("../migrations/20260926200000_core_orders_payments_audit.sql",root),"utf8"));
const after=(await one(snapshotSQL)).snapshot;
writeFileSync(new URL("core-expected.json",root),JSON.stringify(after));
await check("forward migration preserves existing schema/capabilities; adds 12 forced-RLS tables",async()=>{
 for(const key of ["columns","constraints","indexes","triggers","functions","tables"])
 for(const item of before[key])assert.ok(after[key].some(x=>JSON.stringify(x)===JSON.stringify(item)),key+" "+item.slice(0,3));
 assert.equal(after.tables.length,30);assert.equal(after.policies,0);
});
await db.query("INSERT INTO app.businesses(id,slug,display_name) VALUES ($1,'test','Test'),($2,'other','Other')",[id(1),id(2)]);
await db.query("INSERT INTO app.stores(id,business_id,code,name,address_line1,city,state,delivery_enabled,pickup_enabled) VALUES ($1,$2,'main','Main','Street','City','State',true,true),($3,$2,'branch','Branch','Street','City','State',true,true),($4,$5,'other','Other','Street','City','State',true,true)",[id(10),id(1),id(11),id(12),id(2)]);
await db.query("INSERT INTO app.business_settings(business_id,employee_operational_history_days,employee_cash_collection_limit_paise,require_payment_before_completion,max_order_items,max_order_total_paise) VALUES ($1,7,100000,true,20,10000000),($2,7,NULL,true,20,10000000)",[id(1),id(2)]);
for(const [n,b,role] of [[20,1,"OWNER"],[21,1,"OWNER"],[22,1,"EMPLOYEE"],[23,2,"OWNER"],[24,1,"EMPLOYEE"]]){
 await db.query("INSERT INTO auth.users VALUES ($1)",[id(n)]);
 await db.query("INSERT INTO app.staff_profiles(id,business_id,auth_user_id,display_name,role) VALUES ($1,$2,$1,'Test',$3)",[id(n),id(b),role]);
}
await db.query("INSERT INTO app.staff_admin_grants(staff_profile_id) VALUES ($1),($2)",[id(20),id(23)]);
await db.query("INSERT INTO app.staff_store_assignments(business_id,store_id,staff_profile_id) VALUES ($1,$2,$3)",[id(1),id(10),id(22)]);
const category=await as(20,()=>value("SELECT api.save_category(NULL,'Fish',NULL,0,true) AS value"));
const product=await as(20,()=>value("SELECT api.save_product(NULL,$1,'Test Fish','Local','Description','/assets/fish.jpg','[500,1000]','[{\"name\":\"Cleaned\",\"cleaning_loss_percent\":25},{\"name\":\"Whole\"}]',true) AS value",[category]));
const preparation=await value("SELECT id AS value FROM app.preparation_options WHERE name='Cleaned'");
const offering=await as(20,()=>value("SELECT api.create_offering($1,$2) AS value",[product,id(10)]));
const branchOffering=await as(20,()=>value("SELECT api.create_offering($1,$2) AS value",[product,id(11)]));
await as(21,()=>db.query("SELECT api.update_daily_product($1,1,60001,true)",[offering]));
await as(21,()=>db.query("SELECT api.update_daily_product($1,1,50000,true)",[branchOffering]));
await as(21,()=>db.query("SELECT api.save_delivery_area(NULL,$1,NULL,'560001','Test',3000,20000,true)",[id(10)]));
const payload=(method="HOME_DELIVERY",payment="CASH")=>({
 items:[{productId:product,preparationId:preparation,rawWeightGrams:500,instructions:"  curry  "}],
 method,mobile:"9876543210",name:"Guest",address:{line1:"House",city:"City",state:"State",pincode:"560001"},paymentMethod:payment
});
const quote=(p=payload(),store=id(10))=>checkout("SELECT api.checkout_quote($1,$2) AS value",[store,p]);
const placeSQL="SELECT api.place_order($1,$2,$3,$4,$5,$6) AS value";
function envelope(){const token=randomBytes(32).toString("hex");return {id:randomUUID(),token,digest:createHash("sha256").update(token).digest("hex"),expiry:new Date(Date.now()+86400000).toISOString()};}
async function place(p=payload(),store=id(10)){const quoted=await quote(p,store);const e=envelope();const args=[store,e.id,p,quoted.quoteDigest,e.digest,e.expiry];return {order:await checkout(placeSQL,args),quoted,e,args};}
let cash,online;
await check("trusted repricing uses integer-paise rounding and configured delivery fees",async()=>{
 const result=await quote();
 assert.equal(result.subtotalPaise,30001);assert.equal(result.deliveryFeePaise,3000);assert.equal(result.totalPaise,33001);
 assert.equal(result.items[0].snapshot.estimatedCleanedWeightGrams,375);
 assert.equal(result.items[0].instructions,"curry");assert.match(result.quoteDigest,/^[a-f0-9]{64}$/);
 for(const forged of [{...payload(),totalPaise:1},{...payload(),deliveryFee:0},{...payload(),items:[{...payload().items[0],price:1}]}])
 await assert.rejects(()=>quote(forged),e=>e.code==="22023");
});
await check("duplicate selections normalize whitespace/Unicode; legitimate variants stay separate",async()=>{
 const p=payload();p.items.push({...p.items[0],instructions:"curry"});
 await assert.rejects(()=>quote(p),e=>e.code==="22023");
 p.items[1].instructions="other";assert.equal((await quote(p)).items.length,2);
 p.items[0].instructions="caf\u00e9";p.items[1].instructions="cafe\u0301";
 await assert.rejects(()=>quote(p),e=>e.code==="22023");
 for(const grams of [0,250,1.5])await assert.rejects(()=>quote({...payload(),items:[{...payload().items[0],rawWeightGrams:grams}]}));
});
await check("quote changes require review and failed placement leaves no partial order/request/payment",async()=>{
 const p=payload(),result=await quote(p),e=envelope();
 await as(21,()=>db.query("SELECT api.update_daily_product($1,2,62000,true)",[offering]));
 await assert.rejects(()=>checkout(placeSQL,[id(10),e.id,p,result.quoteDigest,e.digest,e.expiry]),x=>x.code==="40001");
 for(const table of ["orders","order_items","payments","order_requests","order_access_tokens"])assert.equal(await value("SELECT count(*)::int AS value FROM app."+table),0);
 await as(21,()=>db.query("SELECT api.update_daily_product($1,3,60001,true)",[offering]));
});
await check("atomic placement creates immutable snapshots, pending cash and digest-only tracking",async()=>{
 cash=await place();assert.match(cash.order.orderNumber,/^TFM-\d{6,}$/);
 assert.equal(await value("SELECT status AS value FROM app.payments WHERE order_id=$1",[cash.order.id]),"PENDING");
 const row=await one("SELECT encode(token_digest,'hex') AS digest,expires_at FROM app.order_access_tokens WHERE order_id=$1",[cash.order.id]);
 assert.equal(row.digest,cash.e.digest);assert.notEqual(row.digest,cash.e.token);
 assert.equal(await value("SELECT count(*)::int AS value FROM app.customers"),0);
 const snap=await value("SELECT fulfillment_snapshot AS value FROM app.orders WHERE id=$1",[cash.order.id]);
 assert.equal(snap.mobileE164,"+919876543210");assert.equal(snap.store.name,"Main");
});
await check("exact checkout retries return one order; altered request or token cannot replay",async()=>{
 const retry=await checkout(placeSQL,cash.args);assert.equal(retry.id,cash.order.id);assert.equal(retry.replayed,true);
 const altered=[...cash.args];altered[2]={...payload(),name:"Changed"};
 await assert.rejects(()=>checkout(placeSQL,altered),e=>e.code==="22023");
 altered[2]=cash.args[2];altered[4]=envelope().digest;
 await assert.rejects(()=>checkout(placeSQL,altered),e=>e.code==="22023");
 assert.equal(await value("SELECT count(*)::int AS value FROM app.orders"),1);
});
await check("tracking token authorizes minimal status only; order number/mobile/invalid token fail",async()=>{
 const result=await as(null,()=>value("SELECT api.track_order($1) AS value",[cash.e.token]),"anon");
 assert.equal(result.orderNumber,cash.order.orderNumber);
 for(const key of ["mobile","address","Guest","House",cash.order.id])assert.equal(JSON.stringify(result).includes(key),false);
 for(const token of [null,"9876543210",cash.order.orderNumber,randomBytes(32).toString("hex")])assert.equal(await value("SELECT api.track_order($1) AS value",[token]),null);
});
await check("browser/service roles cannot place orders or invoke provider verification",async()=>{
 for(const role of ["anon","authenticated","service_role"]){
  await denied(20,placeSQL,cash.args,role);
  await denied(20,"SELECT api.record_verified_payment($1,'p','e','PAID',33001,'INR')",[id(999)],role);
 }
 await denied(null,"SELECT api.record_verified_payment($1,'p','e','PAID',33001,'INR')",[id(999)],"trait_checkout");
 await denied(null,placeSQL,cash.args,"trait_payment_verifier");
});
await check("staff order visibility is scoped to business/store assignment and active membership",async()=>{
 assert.equal((await as(22,()=>value("SELECT api.order_detail($1) AS value",[cash.order.id]))).order.id,cash.order.id);
 for(const n of [23,24,99])await denied(n,"SELECT api.order_detail($1)",[cash.order.id]);
 const branch=await place(payload("STORE_PICKUP"),id(11));await denied(22,"SELECT api.order_detail($1)",[branch.order.id]);
 await db.query("UPDATE app.staff_profiles SET is_active=false,disabled_at=now() WHERE id=$1",[id(22)]);
 await denied(22,"SELECT api.order_detail($1)",[cash.order.id]);
 await db.query("UPDATE app.staff_profiles SET is_active=true,disabled_at=NULL WHERE id=$1",[id(22)]);
});
await check("status workflow rejects skipped/stale transitions; measurements never reprice",async()=>{
 await assert.rejects(()=>as(22,()=>db.query("SELECT api.transition_order($1,1,'DELIVERED')",[cash.order.id])),e=>e.code==="22023");
 await as(22,()=>db.query("SELECT api.transition_order($1,1,'CONFIRMED')",[cash.order.id]));
 await assert.rejects(()=>as(22,()=>db.query("SELECT api.transition_order($1,1,'PREPARING')",[cash.order.id])),e=>e.code==="40001");
 await as(22,()=>db.query("SELECT api.transition_order($1,2,'PREPARING')",[cash.order.id]));
 const item=await value("SELECT id AS value FROM app.order_items WHERE order_id=$1",[cash.order.id]);
 await as(22,()=>db.query("SELECT api.record_fulfilled_weight($1,$2,3,360)",[cash.order.id,item]));
 assert.equal(await value("SELECT total_paise AS value FROM app.orders WHERE id=$1",[cash.order.id]),33001);
 assert.equal(await value("SELECT raw_weight_grams AS value FROM app.order_items WHERE id=$1",[item]),500);
 await as(22,()=>db.query("SELECT api.transition_order($1,4,'READY')",[cash.order.id]));
 await as(22,()=>db.query("SELECT api.transition_order($1,5,'OUT_FOR_DELIVERY')",[cash.order.id]));
 await assert.rejects(()=>as(22,()=>db.query("SELECT api.transition_order($1,6,'DELIVERED')",[cash.order.id])),e=>e.code==="22023");
});
const paymentOf=order=>one("SELECT * FROM app.payments WHERE order_id=$1",[order]);
await check("cash collection obeys employee limits and settles once with audit",async()=>{
 const p=await paymentOf(cash.order.id);
 await db.query("UPDATE app.business_settings SET employee_cash_collection_limit_paise=NULL WHERE business_id=$1",[id(1)]);
 await denied(22,"SELECT api.receive_cash($1,1)",[p.id]);
 await db.query("UPDATE app.business_settings SET employee_cash_collection_limit_paise=33000 WHERE business_id=$1",[id(1)]);
 await denied(22,"SELECT api.receive_cash($1,1)",[p.id]);
 await db.query("UPDATE app.business_settings SET employee_cash_collection_limit_paise=100000 WHERE business_id=$1",[id(1)]);
 await as(22,()=>db.query("SELECT api.receive_cash($1,1)",[p.id]));
 await assert.rejects(()=>as(22,()=>db.query("SELECT api.receive_cash($1,1)",[p.id])),e=>e.code==="40001");
 await as(22,()=>db.query("SELECT api.transition_order($1,6,'DELIVERED')",[cash.order.id]));
 assert.equal((await paymentOf(cash.order.id)).status,"PAID");
});
await check("pickup completes from READY; cancellation is separate, reasoned and OWNER/ADMIN only",async()=>{
 const pickup=await place(payload("STORE_PICKUP"));const p=await paymentOf(pickup.order.id);
 await as(21,()=>db.query("SELECT api.receive_cash($1,1)",[p.id]));
 for(const [v,status] of [[1,"CONFIRMED"],[2,"PREPARING"],[3,"READY"]])await as(22,()=>db.query("SELECT api.transition_order($1,$2,$3)",[pickup.order.id,v,status]));
 await assert.rejects(()=>as(22,()=>db.query("SELECT api.transition_order($1,4,'OUT_FOR_DELIVERY')",[pickup.order.id])),e=>e.code==="22023");
 await as(22,()=>db.query("SELECT api.transition_order($1,4,'DELIVERED')",[pickup.order.id]));
 const cancelled=await place();await denied(22,"SELECT api.transition_order($1,1,'CANCELLED','Test')",[cancelled.order.id]);
 await as(21,()=>db.query("SELECT api.transition_order($1,1,'CANCELLED','Requested')",[cancelled.order.id]));
 const cp=await paymentOf(cancelled.order.id);
 await assert.rejects(()=>as(21,()=>db.query("SELECT api.receive_cash($1,1)",[cp.id])),e=>e.code==="22023");
 await assert.rejects(()=>as(21,()=>db.query("SELECT api.transition_order($1,2,'CONFIRMED')",[cancelled.order.id])),e=>e.code==="22023");
});
await check("online reference is evidence only; browser/staff cannot confirm online settlement",async()=>{
 online=await place(payload("HOME_DELIVERY","UPI"));const p=await paymentOf(online.order.id);
 await as(22,()=>db.query("SELECT api.submit_payment_reference($1,1,'UTR12345')",[p.id]));
 assert.equal((await paymentOf(online.order.id)).status,"VERIFYING");
 await assert.rejects(()=>as(21,()=>db.query("SELECT api.receive_cash($1,2)",[p.id])),e=>e.code==="22023");
 await denied(20,"SELECT api.bind_provider_payment($1,$2,'payment-1')",[p.id,id(100)]);
});
let account;
await check("provider settlement verifies registered merchant/reference/amount/currency and is idempotent",async()=>{
 account=await value("INSERT INTO app.payment_provider_accounts(business_id,provider,merchant_reference,is_active) VALUES ($1,'synthetic','merchant-test',true) RETURNING id AS value",[id(1)]);
 const p=await paymentOf(online.order.id);
 await verifier("SELECT api.bind_provider_payment($1,$2,'payment-1')",[p.id,account]);
 for(const [ref,amount,currency] of [["wrong",33001,"INR"],["payment-1",1,"INR"],["payment-1",33001,"USD"]])
 await assert.rejects(()=>verifier("SELECT api.record_verified_payment($1,$2,'event-1','PAID',$3,$4)",[account,ref,amount,currency]),e=>e.code==="22023");
 await verifier("SELECT api.record_verified_payment($1,'payment-1','event-1','PAID',33001,'INR')",[account]);
 const first=await paymentOf(online.order.id);
 await verifier("SELECT api.record_verified_payment($1,'payment-1','event-1','PAID',33001,'INR')",[account]);
 assert.deepEqual(await paymentOf(online.order.id),first);
 await assert.rejects(()=>verifier("SELECT api.record_verified_payment($1,'payment-1','event-1','FAILED',33001,'INR')",[account]),e=>e.code==="22023");
 await assert.rejects(()=>verifier("SELECT api.record_verified_payment($1,'payment-1','event-2','FAILED',33001,'INR')",[account]),e=>e.code==="22023");
 assert.equal(first.status,"PAID");
});
const refundSQL="SELECT api.request_refund($1,$2,$3,$4,$5) AS value";
let onlineRefund,cashRefund;
await check("refund allocations are scoped, bounded, idempotent and OWNER/ADMIN only",async()=>{
 const p=await paymentOf(online.order.id);const item=await value("SELECT id AS value FROM app.order_items WHERE order_id=$1",[online.order.id]);
 const key=randomUUID(),alloc=[{itemId:item,amountPaise:10000}];
 await denied(22,refundSQL,[p.id,p.version,key,alloc,"Test"]);
 await denied(23,refundSQL,[p.id,p.version,key,alloc,"Test"]);
 onlineRefund=await as(21,()=>value(refundSQL,[p.id,p.version,key,alloc,"Test"]));
 assert.equal(await as(21,()=>value(refundSQL,[p.id,p.version,key,alloc,"Test"])),onlineRefund);
 const now=await paymentOf(online.order.id);
 for(const allocations of [[{itemId:item,amountPaise:30001}],[{itemId:id(999),amountPaise:1}],[{amountPaise:3001}],[{itemId:item,amountPaise:1},{itemId:item,amountPaise:1}]]){
 await assert.rejects(()=>as(21,()=>value(refundSQL,[p.id,now.version,randomUUID(),allocations,"Test"])),e=>e.code==="22023");
 }
 await denied(21,"SELECT api.complete_cash_refund($1,1)",[onlineRefund]);
 assert.equal((await paymentOf(online.order.id)).refunded_paise,0);
});
await check("online refund completion requires provider identity, exact amount and replay-safe event",async()=>{
 await verifier("SELECT api.bind_provider_refund($1,'refund-1')",[onlineRefund]);
 await assert.rejects(()=>verifier("SELECT api.record_verified_refund($1,'payment-1','refund-1','refund-event','COMPLETED',1,'INR')",[account]),e=>e.code==="22023");
 await verifier("SELECT api.record_verified_refund($1,'payment-1','refund-1','refund-event','COMPLETED',10000,'INR')",[account]);
 const p=await paymentOf(online.order.id);assert.equal(p.refunded_paise,10000);assert.equal(p.status,"PAID");
 await verifier("SELECT api.record_verified_refund($1,'payment-1','refund-1','refund-event','COMPLETED',10000,'INR')",[account]);
 assert.deepEqual(await paymentOf(online.order.id),p);
 await assert.rejects(()=>verifier("SELECT api.record_verified_refund($1,'payment-1','refund-1','refund-event','FAILED',10000,'INR')",[account]),e=>e.code==="22023");
});
await check("cash refunds allocate items/fee, cap cumulative refunds and record full REFUNDED state",async()=>{
 const p=await paymentOf(cash.order.id);const item=await value("SELECT id AS value FROM app.order_items WHERE order_id=$1",[cash.order.id]);
 cashRefund=await as(20,()=>value(refundSQL,[p.id,p.version,randomUUID(),[{itemId:item,amountPaise:30001},{amountPaise:3000}],"Full refund"]));
 await denied(22,"SELECT api.complete_cash_refund($1,1)",[cashRefund]);
 await as(21,()=>db.query("SELECT api.complete_cash_refund($1,1)",[cashRefund]));
 const after=await paymentOf(cash.order.id);assert.equal(after.status,"REFUNDED");assert.equal(after.refunded_paise,33001);
 await assert.rejects(()=>as(21,()=>db.query("SELECT api.complete_cash_refund($1,1)",[cashRefund])),e=>e.code==="40001");
});
await check("catalogue/price changes cannot rewrite purchase snapshots or reprice fulfillment",async()=>{
 const before=await q("SELECT * FROM app.order_items WHERE order_id=$1",[cash.order.id]);
 await as(20,()=>db.query("SELECT api.save_product($1,$2,'Renamed','','','/assets/new.jpg','[1000]','[{\"name\":\"Whole\"}]',true)",[product,category]));
 assert.deepEqual(await q("SELECT * FROM app.order_items WHERE order_id=$1",[cash.order.id]),before);
 await bad("UPDATE app.order_items SET price_per_kg_paise=1",[],"42501");
 await bad("UPDATE app.orders SET total_paise=1 WHERE id=$1",[cash.order.id],"23514");
 await bad("UPDATE app.payments SET amount_paise=1 WHERE order_id=$1",[cash.order.id],"23514");
});
await check("tracking revocation and immutable histories; audit covers old and new mutations without contact/token data",async()=>{
 await as(21,()=>db.query("SELECT api.revoke_order_tracking($1)",[cash.order.id]));
 assert.equal(await value("SELECT api.track_order($1) AS value",[cash.e.token]),null);
 for(const table of ["audit_logs","order_status_history","order_item_fulfillment","payment_events","refund_allocations"])await bad("DELETE FROM app."+table,[],"42501");
 await denied(22,"SELECT api.audit_history()");
 const logs=await as(21,()=>value("SELECT api.audit_history(NULL,200) AS value"));
 const actions=new Set(logs.map(x=>x.action));
 for(const action of ["DAILY_PRODUCT_UPDATED","ORDER_PLACED","ORDER_STATUS","FULFILLED_WEIGHT","CASH_RECEIVED","PAYMENT_EVIDENCE","VERIFIED_PAYMENT","REFUND_REQUESTED","REFUND_RESULT"])assert.ok(actions.has(action),action);
 for(const secret of ["9876543210",cash.e.token,online.e.token,"House","UTR12345"])assert.equal(JSON.stringify(logs).includes(secret),false);
});
await check("all tables/sequence/private helpers deny direct access to browser and capability roles",async()=>{
 for(const role of ["anon","authenticated","service_role","trait_checkout","trait_payment_verifier"]){
 const rows=await q("SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,has_table_privilege($1,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS granted FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='app' AND c.relkind='r'",[role]);
 for(const r of rows){assert.ok(r.relrowsecurity&&r.relforcerowsecurity);assert.equal(r.granted,false);}
 await denied(null,"SELECT * FROM app.orders",[],role);
 await denied(null,"SELECT nextval('app.order_number_seq')",[],role);
 await denied(null,"SELECT app.finish_refund($1,'COMPLETED',NULL,'PROVIDER')",[onlineRefund],role);
 }
});

await check("server envelope uses 256-bit random tokens, matching SHA-256 and explicit expiry",async()=>{
 const {createCheckoutEnvelope}=await import("../runtime/checkout-envelope.mjs");
 const expiry=new Date(Date.now()+86400000);
 const a=createCheckoutEnvelope(expiry),b=createCheckoutEnvelope(expiry);
 assert.match(a.trackingToken,/^[a-f0-9]{64}$/);assert.notEqual(a.trackingToken,b.trackingToken);
 assert.equal(a.trackingDigest,createHash("sha256").update(a.trackingToken).digest("hex"));
 assert.notEqual(a.requestId,b.requestId);assert.equal(a.trackingExpiresAt,expiry.toISOString());
 for(const invalid of [null,undefined,"invalid",new Date(0)])assert.throws(()=>createCheckoutEnvelope(invalid));
});
await check("late token uniqueness failure rolls back order/items/payment/history/request and audit",async()=>{
 await as(20,()=>db.query("SELECT api.save_product($1,$2,'Test Fish','Local','Description','/assets/fish.jpg','[500,1000]','[{\"name\":\"Cleaned\",\"cleaning_loss_percent\":25},{\"name\":\"Whole\"}]',true)",[product,category]));
 const p=payload(),fresh=await quote(p);
 const before={};
 for(const table of ["orders","order_items","payments","order_status_history","payment_events","order_requests","audit_logs"])before[table]=await value("SELECT count(*)::int AS value FROM app."+table);
 await assert.rejects(()=>checkout(placeSQL,[id(10),randomUUID(),p,fresh.quoteDigest,cash.e.digest,new Date(Date.now()+86400000).toISOString()]),e=>e.code==="23505");
 for(const table of Object.keys(before))assert.equal(await value("SELECT count(*)::int AS value FROM app."+table),before[table],table);
});
await check("unavailable catalogue and delivery changes reject checkout",async()=>{
 await as(21,()=>db.query("SELECT api.update_daily_product($1,4,60001,false)",[offering]));
 await assert.rejects(()=>quote(),e=>e.code==="22023");
 await as(21,()=>db.query("SELECT api.update_daily_product($1,5,60001,true)",[offering]));
 const p=payload(),old=await quote(p),e=envelope();
 const area=await one("SELECT * FROM app.delivery_areas WHERE store_id=$1",[id(10)]);
 await as(21,()=>db.query("SELECT api.save_delivery_area($1,$2,$3,'560001','Test',4000,20000,true)",[area.id,id(10),area.version]));
 await assert.rejects(()=>checkout(placeSQL,[id(10),e.id,p,old.quoteDigest,e.digest,e.expiry]),x=>x.code==="40001");
 await db.query("UPDATE app.stores SET delivery_enabled=false WHERE id=$1",[id(10)]);
 await assert.rejects(()=>quote(),x=>x.code==="22023");
 await db.query("UPDATE app.stores SET delivery_enabled=true WHERE id=$1",[id(10)]);
});
await check("employee history window and assignment revocation prevent order operations",async()=>{
 await db.query("BEGIN");
 await db.query("ALTER TABLE app.orders DISABLE TRIGGER immutable_snapshot");
 await db.query("UPDATE app.orders SET created_at=now()-interval '8 days' WHERE id=$1",[online.order.id]);
 await db.query("ALTER TABLE app.orders ENABLE TRIGGER immutable_snapshot");
 assert.equal((await as(22,()=>value("SELECT api.order_queue($1) AS value",[id(10)]))).some(o=>o.id===online.order.id),false);
 await db.exec("SAVEPOINT denied_old_order");
 await db.exec("SET ROLE authenticated");
 await db.query("SELECT set_config(\'request.jwt.claim.sub\',$1,false)",[id(22)]);
 await assert.rejects(()=>db.query("SELECT api.order_detail($1)",[online.order.id]),e=>e.code==="42501");
 await db.exec("ROLLBACK TO SAVEPOINT denied_old_order");
 await db.query("ROLLBACK");
 await db.query("UPDATE app.staff_store_assignments SET is_active=false WHERE staff_profile_id=$1",[id(22)]);
 await denied(22,"SELECT api.order_detail($1)",[online.order.id]);
 await db.query("UPDATE app.staff_store_assignments SET is_active=true WHERE staff_profile_id=$1",[id(22)]);
});
await check("expired tracking gives the same generic result without PII",async()=>{
 await db.query("BEGIN");
 await db.query("ALTER TABLE app.order_access_tokens DISABLE TRIGGER immutable_snapshot");
 await db.query("UPDATE app.order_access_tokens SET created_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE order_id=$1",[online.order.id]);
 await db.query("ALTER TABLE app.order_access_tokens ENABLE TRIGGER immutable_snapshot");
 assert.equal(await value("SELECT api.track_order($1) AS value",[online.e.token]),null);
 await db.query("ROLLBACK");
});
await check("failed provider payments and refunds preserve accounting and reserved amounts",async()=>{
 const fresh=await place(payload("STORE_PICKUP","ONLINE"));const p=await paymentOf(fresh.order.id);
 await verifier("SELECT api.bind_provider_payment($1,$2,'payment-failed')",[p.id,account]);
 await verifier("SELECT api.record_verified_payment($1,'payment-failed','failed-1','FAILED',$2,'INR')",[account,p.amount_paise]);
 assert.equal((await paymentOf(fresh.order.id)).status,"FAILED");
 await verifier("SELECT api.record_verified_payment($1,'payment-failed','late-success','PAID',$2,'INR')",[account,p.amount_paise]);
 const paid=await paymentOf(fresh.order.id);const item=await value("SELECT id AS value FROM app.order_items WHERE order_id=$1",[fresh.order.id]);
 const r=await as(21,()=>value(refundSQL,[p.id,paid.version,randomUUID(),[{itemId:item,amountPaise:1000}],"Test"]));
 await verifier("SELECT api.bind_provider_refund($1,'refund-failed')",[r]);
 await verifier("SELECT api.record_verified_refund($1,'payment-failed','refund-failed','failed-refund-event','FAILED',1000,'INR')",[account]);
 assert.equal((await paymentOf(fresh.order.id)).refunded_paise,0);
 const next=await paymentOf(fresh.order.id);
 const replacement=await as(21,()=>value(refundSQL,[p.id,next.version,randomUUID(),[{itemId:item,amountPaise:p.amount_paise}],"Retry new refund request"]));
 assert.ok(replacement);
});
await check("provider binding cannot cross businesses or use an inactive merchant",async()=>{
 const foreign=await value("INSERT INTO app.payment_provider_accounts(business_id,provider,merchant_reference,is_active) VALUES ($1,'synthetic','foreign-test',true) RETURNING id AS value",[id(2)]);
 const fresh=await place(payload("STORE_PICKUP","ONLINE"));const p=await paymentOf(fresh.order.id);
 await assert.rejects(()=>verifier("SELECT api.bind_provider_payment($1,$2,'wrong-merchant')",[p.id,foreign]),e=>e.code==="22023");
 await db.query("UPDATE app.payment_provider_accounts SET is_active=false WHERE id=$1",[account]);
 await assert.rejects(()=>verifier("SELECT api.bind_provider_payment($1,$2,'inactive')",[p.id,account]),e=>e.code==="22023");
 await db.query("UPDATE app.payment_provider_accounts SET is_active=true WHERE id=$1",[account]);
});
await check("capability roles are nonlogin, unprovisioned and expose only intended RPCs",async()=>{
 for(const [role,allowed] of [["trait_checkout",["checkout_quote","place_order"]],["trait_payment_verifier",["bind_provider_payment","record_verified_payment","bind_provider_refund","record_verified_refund"]]]){
 const row=await one("SELECT rolcanlogin,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=$1",[role]);
 assert.ok(Object.values(row).every(x=>x===false));
 const callable=await q("SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('app','api') AND has_function_privilege($1,p.oid,'EXECUTE') ORDER BY p.proname",[role]);
 assert.deepEqual(callable.map(x=>x.proname),allowed.sort());
 }
});


await check("order item price provenance and finance history enforce tenant/role scope",async()=>{
 const history=await as(21,()=>value("SELECT api.payment_history($1) AS value",[cash.order.id]));
 assert.ok(history.refunds.length);assert.ok(history.events.length);assert.ok(history.allocations.length);
 for(const n of [22,23,99])await denied(n,"SELECT api.payment_history($1)",[cash.order.id]);
 const line=await one("SELECT * FROM app.order_items WHERE order_id=$1",[cash.order.id]);
 const wrong=await value("SELECT id AS value FROM app.product_prices WHERE offering_id=$1",[branchOffering]);
 await bad("INSERT INTO app.order_items(business_id,order_id,line_number,product_id,preparation_id,price_id,product_snapshot,raw_weight_grams,price_per_kg_paise,line_total_paise,instructions) VALUES ($1,$2,100,$3,$4,$5,'{}',500,50000,25000,'wrong store')",[id(1),cash.order.id,line.product_id,line.preparation_id,wrong],"23514");
});

console.log("Core backend: "+checks+" validation groups passed.");
await db.close();
