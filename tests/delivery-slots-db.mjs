process.on('uncaughtException',e=>{console.error(e.message,e.code??'',e.position??'',e.where??'',e.detail??'');process.exit(1);});
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {PGlite} from '../node_modules/.staff-validation/node_modules/@electric-sql/pglite/dist/index.js';
const db=new PGlite();
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const query=(s,a=[])=>db.query(s,a);
const value=async(s,a=[])=>(await query(s,a)).rows[0].value;
async function as(n,sql,args=[],role='authenticated'){await db.exec('SET ROLE '+role);await query("select set_config('request.jwt.claim.sub',$1,false)",[n?id(n):'']);try{return await value(sql,args);}finally{await db.exec('RESET ROLE');}}
await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY); CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;");
for(const f of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort())await db.exec(readFileSync('supabase/migrations/'+f,'utf8'));
await query("insert into app.businesses(id,slug,display_name) values($1,'test','Test'),($2,'other','Other')",[id(1),id(2)]);
await query("insert into app.stores(id,business_id,code,name,address_line1,city,state,pickup_enabled) values($1,$2,'test','Test','Test street','Test city','Test state',true)",[id(10),id(1)]);
await query("insert into app.business_settings(business_id,employee_operational_history_days,require_payment_before_completion,max_order_items,max_order_total_paise) values($1,30,false,20,10000000)",[id(1)]);
for(const [n,b,role] of [[20,1,'OWNER'],[21,1,'OWNER'],[22,1,'EMPLOYEE'],[23,2,'OWNER']]){await query('insert into auth.users values($1)',[id(n)]);await query("insert into app.staff_profiles(id,business_id,auth_user_id,display_name,role) values($1,$2,$1,'Test',$3)",[id(n),id(b),role]);}
await query('insert into app.staff_admin_grants(staff_profile_id) values($1),($2)',[id(20),id(23)]);
await query('insert into app.staff_store_assignments(business_id,store_id,staff_profile_id) values($1,$2,$3)',[id(1),id(10),id(22)]);
const category=await as(20,"select api.save_category(null,'Test',null,0,true) as value");
const p=await as(20,`select api.save_product(null,$1,'Fish','','','','[500,1000]','[{"name":"Whole"}]',true) as value`,[category]);
await as(20,"select api.configure_product_pricing($1,'RAW_WEIGHT',1000,null,'[500,1000]',60000,true) as value",[p]);
const o=await value('select id as value from app.product_store_settings where product_id=$1',[p]);
await as(21,'select api.update_daily_product($1,$2,60000,true) as value',[o,await value('select version as value from app.product_store_settings where id=$1',[o])]);
const prep=await value('select preparation_option_id as value from app.product_preparation_options where product_id=$1',[p]);
const istNow=()=>new Date(Date.now()+330*60000);
const day=n=>new Date(istNow().getTime()+n*86400000).toISOString().slice(0,10);
const late=istNow().toISOString().slice(11,16)>='23:50';

// Settings: ADMIN/OWNER of the business only, validated, versioned, audited; the table stays closed.
const save=(actor,a)=>as(actor,'select api.save_delivery_slot($1,$2,$3,$4,$5,$6,$7,$8,$9) as value',[id(10),a.id??null,a.version??0,a.name,a.starts,a.ends,a.cutoff,a.max,a.active??true]);
for(const actor of [22,23])await assert.rejects(()=>save(actor,{name:'X',starts:'07:00',ends:'11:00',cutoff:'09:00',max:5}),e=>e.code==='42501');
for(const bad of [{starts:'11:00',ends:'07:00',cutoff:'06:00'},{starts:'07:00',ends:'11:00',cutoff:'11:00'},{starts:'7:00',ends:'11:00',cutoff:'09:00'},{starts:'07:00',ends:'11:00',cutoff:'09:00',max:0},{starts:'07:00',ends:'11:00',cutoff:'09:00',name:'<b>'}])
 await assert.rejects(()=>save(21,{name:'Bad',max:5,...bad}),e=>e.code==='22023');
const closedToday=await save(21,{name:'Early',starts:'00:01',ends:'00:30',cutoff:'00:00',max:5});
const open=await save(21,{name:'Late',starts:'08:00',ends:'23:59',cutoff:'23:58',max:20});
const small=await save(20,{name:'Small',starts:'09:00',ends:'10:00',cutoff:'08:00',max:1});
assert.equal((await as(21,'select api.delivery_slots($1) as value',[id(10)])).length,3);
await assert.rejects(()=>save(21,{id:open,version:5,name:'Late',starts:'08:00',ends:'23:59',cutoff:'23:58',max:20}),e=>e.code==='40001');
await assert.rejects(()=>as(22,'select api.delivery_slots($1) as value',[id(10)]),e=>e.code==='42501');
assert.equal(await value("select count(*)::int as value from app.audit_logs where action='DELIVERY_SLOT_SAVED'"),3);
for(const role of ['anon','authenticated','trait_checkout'])await assert.rejects(async()=>{await db.exec('SET ROLE '+role);try{await query('select * from app.delivery_slots');}finally{await db.exec('RESET ROLE');}},/permission denied/);
console.log('PASS slot settings: ADMIN/OWNER only, validation, optimistic version, audit, closed table');

// Options: server checkout role only; three days; same-day cutoff closes a slot; capacity stays private.
for(const role of ['anon','authenticated'])await assert.rejects(()=>as(null,'select api.delivery_slot_options($1) as value',[id(10)],role),/permission denied/);
const options=()=>as(null,'select api.delivery_slot_options($1) as value',[id(10)],'trait_checkout');
let opts=await options();
assert.deepEqual(opts.map(d=>d.date),[day(0),day(1),day(2)]);
assert.equal(opts[0].slots.find(s=>s.id===closedToday).status,'closed');assert.equal(opts[1].slots.find(s=>s.id===closedToday).status,'open');
assert.ok(!('maxOrders' in opts[0].slots[0]));
console.log('PASS slot options: checkout role only, today + 2 days, cutoff closes today');

// Checkout: a slot is required while any is active; date window, cutoff and capacity are enforced by the server.
const payload=(grams,slot)=>({method:'STORE_PICKUP',mobile:'9876543210',paymentMethod:'CASH',items:[{productId:p,preparationId:prep,rawWeightGrams:grams,instructions:''}],...(slot?{slot}:{})});
const quote=x=>as(null,'select api.checkout_quote($1,$2) as value',[id(10),JSON.stringify(x)],'trait_checkout');
const end=new Date(Date.now()+86400000).toISOString();
const tokens=new Map();
async function place(x,q){const token=randomUUID().replaceAll('-','').repeat(2);const r=await as(null,'select api.place_order($1,$2,$3,$4,$5,$6) as value',[id(10),randomUUID(),JSON.stringify(x),q.quoteDigest,createHash('sha256').update(token).digest('hex'),end],'trait_checkout');tokens.set(r.id,token);return r;}
const ver=order=>value('select version as value from app.orders where id=$1',[order]);
await assert.rejects(()=>quote(payload(1000)),e=>e.code==='22023'&&/choose a slot/.test(e.message));
await assert.rejects(()=>quote(payload(1000,{id:closedToday,date:day(0)})),e=>e.code==='22023'&&/closed/.test(e.message));
await assert.rejects(()=>quote(payload(1000,{id:open,date:day(3)})),e=>e.code==='22023'&&/date/.test(e.message));
await assert.rejects(()=>quote(payload(1000,{id:open,date:day(-1)})),e=>e.code==='22023');
await assert.rejects(()=>quote(payload(1000,{id:open,date:day(1),extra:1})),e=>e.code==='22023');
await assert.rejects(()=>quote(payload(1000,{id:randomUUID(),date:day(1)})),e=>e.code==='22023');
let x=payload(1000,{id:small,date:day(1)});const q=await quote(x);
assert.equal(q.fulfillment.slot.name,'Small');assert.equal(q.fulfillment.slot.date,day(1));
// The slot is part of the digest: a quote for another slot cannot be placed with this one.
const other=await quote(payload(1000,{id:open,date:day(1)}));assert.notEqual(other.quoteDigest,q.quoteDigest);
await assert.rejects(()=>place(x,other),e=>e.code==='40001');
const tomorrow=await place(x,q);
assert.equal(await value('select delivery_date::text as value from app.orders where id=$1',[tomorrow.id]),day(1));
await assert.rejects(()=>quote(payload(500,{id:small,date:day(1)})),e=>e.code==='22023'&&/full/.test(e.message));
await assert.rejects(()=>place(payload(500,{id:small,date:day(1)}),q),e=>e.code==='22023');
opts=await options();assert.equal(opts[1].slots.find(s=>s.id===small).status,'full');assert.equal(opts[2].slots.find(s=>s.id===small).status,'open');
console.log('PASS checkout: slot required, date window, cutoff, unknown slot, digest covers slot, full at quote and place');

// Stock: only same-day orders reserve. Morning entry is the physical count; available = count - reserved.
const daily=async()=>(await as(21,'select api.daily_products($1) as value',[id(10)])).find(r=>r.id===o);
const setStock=async stock=>{const r=await daily();return as(21,'select api.save_daily_product($1,$2,$3,$4,$5,$6) as value',[r.id,r.version,r.pricePaise,r.available,r.stockVersion,stock]);};
const onHand=()=>value('select on_hand as value from app.offering_stock where offering_id=$1',[o]);
await setStock(5000);
assert.equal(await onHand(),5000);assert.equal((await daily()).reserved,0);
x=payload(1000,{id:open,date:day(2)});await place(x,await quote(x));
assert.equal(await onHand(),5000,'a later-day order does not deduct');
if(!late){
 x=payload(1000,{id:open,date:day(0)});const today=await place(x,await quote(x));
 assert.equal(await onHand(),4000,'a same-day order deducts');
 let r=await daily();assert.equal(r.reserved,1000);assert.equal(r.stock,4000);
 // Recount: 3 kg in the shop with 1 kg reserved leaves 2 kg to sell.
 await setStock(3000);r=await daily();assert.equal(r.stock,2000);assert.equal(r.reserved,1000);
 assert.match(await value("select note as value from app.stock_movements where kind='SET' order by created_at desc limit 1"),/In shop 3000, reserved 1000/);
 // In shop below reserved: nothing left to sell, never negative.
 await setStock(500);assert.equal(await onHand(),0);
 // Same-day quotes are checked against available stock; later days are not.
 await assert.rejects(()=>quote(payload(500,{id:open,date:day(0)})),e=>e.code==='22023'&&/Not enough stock/.test(e.message));
 await quote(payload(1000,{id:open,date:day(1)}));
 // Cancelling today's order after the recount puts its 1 kg back; cancelling a later-day order changes nothing.
 await setStock(3000);
 await as(21,"select api.transition_order($1,$2,'CANCELLED','Changed mind') as value",[today.id,await ver(today.id)]);
 assert.equal(await onHand(),3000);
 await as(21,"select api.transition_order($1,$2,'CANCELLED','Changed mind') as value",[tomorrow.id,await ver(tomorrow.id)]);
 assert.equal(await onHand(),3000);
 assert.equal(await value('select count(*)::int as value from app.stock_movements where order_id=$1',[tomorrow.id]),0);
 assert.equal((await options())[1].slots.find(s=>s.id===small).status,'open','a cancel frees the slot');
 // Dispatched (here: picked up) orders are no longer reserved.
 x=payload(500,{id:open,date:day(0)});const d=await place(x,await quote(x));
 assert.equal((await daily()).reserved,500);
 for(const s of ['CONFIRMED','PREPARING','READY','DELIVERED'])await as(22,'select api.transition_order($1,$2,$3) as value',[d.id,await ver(d.id),s]);
 assert.equal((await daily()).reserved,0);
 console.log('PASS stock: later days never reserve; available = in shop - reserved; recount, cancel restore, dispatch');
} else console.log('SKIP same-day stock checks (run before 23:50 IST)');

// Dashboard, order filters and tracking show the slot.
const dash=await as(21,'select api.admin_dashboard($1) as value',[id(10)]);
assert.equal(dash.today,day(0));
assert.deepEqual(dash.slots.map(s=>s.name),['Early','Late','Small']);
const sched=dash.scheduled.find(s=>s.slotId===open&&s.date===day(2));
assert.equal(sched.orders,1);assert.deepEqual(sched.products.map(i=>[i.name,Number(i.quantity)]),[['Fish',1000]]);
const emp=await as(22,'select api.admin_dashboard($1) as value',[id(10)]);
assert.ok(emp.scheduled.length>0&&!emp.summary,'employees see what to prepare, no money');
const page=await as(22,'select api.order_queue_page($1,50,null,null,null,$2,$3) as value',[id(10),day(2),open]);
assert.equal(page.length,1);assert.equal(page[0].slot.name,'Late');assert.equal(page[0].delivery_date,day(2));
assert.equal((await as(22,'select api.order_queue_page($1,50,null,null,null,$2,$3) as value',[id(10),day(2),small])).length,0);
const tracked=await as(null,'select api.track_order($1) as value',[tokens.get(page[0].id)],'anon');
assert.deepEqual([tracked.slot.name,tracked.slot.date,tracked.slot.startsAt,tracked.slot.endsAt],['Late',day(2),'08:00','23:59']);
// No active slots: checkout works without one (a store that never set slots up).
for(const s of await as(21,'select api.delivery_slots($1) as value',[id(10)]))await save(21,{id:s.id,version:s.version,name:s.name,starts:s.startsAt,ends:s.endsAt,cutoff:s.cutoffAt,max:s.maxOrders,active:false});
assert.deepEqual(await options(),[]);
await quote(payload(500));
console.log('PASS dashboard slots and scheduled prep, order filters by day and slot, tracking slot, no-slot stores');
