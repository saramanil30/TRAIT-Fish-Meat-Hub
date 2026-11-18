process.on('uncaughtException',e=>{console.error(e.message,e.code??'',e.position??'',e.where??'',e.detail??'');process.exit(1);});
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
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
const rows={};
for(const [name,basis,grams,count,quantities,price] of [['Fish','RAW_WEIGHT',1000,null,[500,1000],60000],['Eggs','TRAY',null,30,[1,2],45000]]){
 const p=await as(20,`select api.save_product(null,$1,$2,'','','','[500,1000]','[{"name":"Whole"}]',true) as value`,[category,name]);
 await as(20,'select api.configure_product_pricing($1,$2,$3,$4,$5,$6,true) as value',[p,basis,grams,count,JSON.stringify(quantities),price]);
 const o=await value('select id as value from app.product_store_settings where product_id=$1',[p]).catch(()=>null)??await as(20,'select api.create_offering($1,$2) as value',[p,id(10)]);
 await as(21,'select api.update_daily_product($1,$2,$3,true) as value',[o,await value('select version as value from app.product_store_settings where id=$1',[o]),price]);
 rows[name]={p,o,price};
}
const daily=async name=>(await as(21,'select api.daily_products($1) as value',[id(10)])).find(r=>r.id===rows[name].o);
const setStock=async(name,stock,available=true)=>{const r=await daily(name);return as(21,'select api.save_daily_product($1,$2,$3,$4,$5,$6) as value',[r.id,r.version,r.pricePaise,available,r.stockVersion,stock]);};
const ask=(product,mobile,sub=null)=>as(null,'select api.request_restock_alert($1,$2,$3,$4) as value',[id(10),product,mobile,sub&&JSON.stringify(sub)],'trait_checkout');
const due=()=>as(null,'select api.restock_push_due($1) as value',[id(10)],'trait_checkout');
const waiting=(actor=21)=>as(actor,'select api.restock_waiting($1) as value',[id(10)]);
const sub=n=>({endpoint:'https://fcm.googleapis.com/fcm/send/abc'+n,p256dh:'B'+'A'.repeat(86),auth:'A'.repeat(22)});

// Only sold-out products take requests; available ones answer AVAILABLE and store nothing.
assert.equal((await ask(rows.Fish.p,'9876543210')).status,'AVAILABLE');
assert.equal(await value('select count(*)::int as value from app.restock_requests'),0);
await setStock('Fish',0);await setStock('Eggs',null,false);
assert.equal((await ask(rows.Fish.p,'98765 43210',sub(1))).status,'WAITING');
// One per number per product: the same number again (any format) keeps one row and its first browser.
assert.equal((await ask(rows.Fish.p,'+919876543210',sub(2))).status,'WAITING');
assert.equal(await value('select count(*)::int as value from app.restock_requests'),1);
assert.match(await value("select push_subscription->>'endpoint' as value from app.restock_requests"),/abc1$/);
await ask(rows.Fish.p,'9123456789');await ask(rows.Eggs.p,'9876543210',sub(3));
// Invalid numbers, products and push endpoints are rejected.
for(const [p,m,s] of [[rows.Fish.p,'12345',null],[id(99),'9876543210',null],[rows.Fish.p,'9876543210',{...sub(4),endpoint:'https://evil.example/push'}],[rows.Fish.p,'9876543210',{...sub(4),extra:1}]])
 await assert.rejects(()=>ask(p,m,s),e=>e.code==='22023');
console.log('PASS request: sold out only, one per number per product, validation');

// Direct table access is denied to every client role; requesting and claiming need the checkout role.
for(const role of ['anon','authenticated','trait_checkout','service_role'])await assert.rejects(async()=>{await db.exec('SET ROLE '+role);try{await query('select * from app.restock_requests');}finally{await db.exec('RESET ROLE');}},/permission denied/);
for(const role of ['anon','authenticated'])await assert.rejects(()=>as(21,'select api.request_restock_alert($1,$2,$3,null) as value',[id(10),rows.Fish.p,'9876543210'],role),/permission denied/);
await assert.rejects(()=>as(21,'select api.restock_push_due($1) as value',[id(10)]),/permission denied/);
await assert.rejects(()=>as(null,'select api.restock_waiting($1) as value',[id(10)],'trait_checkout'),/permission denied/);
// Waiting lists: ADMIN/OWNER of this business only.
for(const actor of [22,23])await assert.rejects(()=>waiting(actor),e=>e.code==='42501');
let list=await waiting();
assert.deepEqual(list.map(x=>[x.productName,x.waiting,x.available]),[['Fish',2,false],['Eggs',1,false]]);
assert.equal(list[0].requests[0].mobile,'+919876543210');
console.log('PASS access: RLS, checkout-only request/claim, ADMIN/OWNER-only waiting list');

// Nothing is due while sold out; once back, each push is claimed exactly once.
assert.deepEqual(await due(),[]);
await setStock('Fish',5000);
const pushes=await due();
assert.deepEqual(pushes.map(x=>[x.productName,x.subscription.endpoint.slice(-4)]),[['Fish','abc1']]);
assert.deepEqual(await due(),[]);
list=await waiting();
assert.equal(list.find(x=>x.productName==='Fish').available,true);
assert.equal(list.find(x=>x.productName==='Fish').requests.find(r=>r.mobile==='+919876543210').pushed,true);
// Mark notified: counted out of "waiting", audited without the number, repeat is a no-op, other tenants denied.
const target=list.find(x=>x.productName==='Fish').requests[0].id;
await assert.rejects(()=>as(23,'select api.mark_restock_notified($1) as value',[target]),e=>e.code==='42501');
await assert.rejects(()=>as(22,'select api.mark_restock_notified($1) as value',[target]),e=>e.code==='42501');
const first=await as(21,'select api.mark_restock_notified($1) as value',[target]);
assert.equal((await as(20,'select api.mark_restock_notified($1) as value',[target])).notifiedAt,first.notifiedAt);
assert.equal((await waiting()).find(x=>x.productName==='Fish').waiting,1);
assert.equal(await value("select count(*)::int as value from app.audit_logs where action='RESTOCK_NOTIFIED' and context::text not like '%98765%'"),1);
// Sold out again: the same number starts a fresh request.
await setStock('Fish',0);
await ask(rows.Fish.p,'9876543210');
const again=await value("select jsonb_build_object('pushed',pushed_at,'notified',notified_at) as value from app.restock_requests where mobile_e164='+919876543210' and product_id=$1",[rows.Fish.p]);
assert.deepEqual(again,{pushed:null,notified:null});
console.log('PASS notify: push claimed once, mark notified (audited, idempotent, tenant-isolated), fresh request after');

// Requests expire after 7 days: hidden from staff, never pushed, and removed on the next request.
await query("update app.restock_requests set requested_at=requested_at-interval '8 days',expires_at=expires_at-interval '8 days' where product_id=$1",[rows.Eggs.p]);
assert.equal((await waiting()).some(x=>x.productName==='Eggs'),false);
await setStock('Eggs',null,true);
assert.deepEqual(await due(),[]);
await ask(rows.Fish.p,'9000000001');
assert.equal(await value('select count(*)::int as value from app.restock_requests where product_id=$1',[rows.Eggs.p]),0);
console.log('PASS expiry: 7 days, hidden, not pushed, purged');
