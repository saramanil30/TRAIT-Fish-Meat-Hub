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
const rows={};
for(const [name,basis,grams,count,quantities,price] of [['Fish','RAW_WEIGHT',1000,null,[500,1000],60000],['Eggs','TRAY',null,30,[1,2],45000]]){
 const p=await as(20,`select api.save_product(null,$1,$2,'','','','[500,1000]','[{"name":"Whole"}]',true) as value`,[category,name]);
 await as(20,'select api.configure_product_pricing($1,$2,$3,$4,$5,$6,true) as value',[p,basis,grams,count,JSON.stringify(quantities),price]);
 const o=await value('select id as value from app.product_store_settings where product_id=$1',[p]).catch(()=>null)??await as(20,'select api.create_offering($1,$2) as value',[p,id(10)]);
 await as(21,'select api.update_daily_product($1,$2,$3,true) as value',[o,await value('select version as value from app.product_store_settings where id=$1',[o]),price]);
 const prep=await value('select preparation_option_id as value from app.product_preparation_options where product_id=$1',[p]);
 rows[name]={p,o,prep,basis,price};
}
const daily=()=>as(21,'select api.daily_products($1) as value',[id(10)]);
const row=async name=>(await daily()).find(r=>r.id===rows[name].o);
const setStock=async(name,stock,actor=21)=>{const r=await row(name);return as(actor,'select api.save_daily_product($1,$2,$3,$4,$5,$6) as value',[r.id,r.version,r.pricePaise,r.available,r.stockVersion,stock]);};
const onHand=name=>value('select on_hand as value from app.offering_stock where offering_id=$1',[rows[name].o]);
const catalogue=async name=>(await as(null,'select api.catalogue($1) as value',[id(10)],'anon')).products.find(p=>p.id===rows[name].p);

// Blank stays unlimited; only ADMIN/OWNER of the business may set stock; values are validated.
assert.equal((await row('Fish')).stock,null);assert.equal((await catalogue('Fish')).stockLeft,null);
for(const actor of [22,23])await assert.rejects(()=>setStock('Fish',3000,actor),e=>e.code==='42501');
await assert.rejects(()=>as(null,'select api.save_daily_product($1,1,1,true,0,1) as value',[rows.Fish.o],'anon'),e=>e.code==='42501');
await assert.rejects(()=>setStock('Fish',-1),e=>e.code==='22023');
const fishVersion=(await row('Fish')).version;
await assert.rejects(()=>as(21,'select api.save_daily_product($1,$2,60000,true,5,1000) as value',[rows.Fish.o,fishVersion]),e=>e.code==='40001');
for(const role of ['anon','authenticated','trait_checkout'])await assert.rejects(async()=>{await db.exec('SET ROLE '+role);try{await query('select * from app.offering_stock');}finally{await db.exec('RESET ROLE');}},/permission denied/);
await setStock('Fish',3000);await setStock('Eggs',3);
assert.equal((await row('Fish')).stock,3000);assert.equal((await row('Eggs')).stock,3);
assert.equal((await catalogue('Fish')).available,true);assert.equal((await catalogue('Fish')).stockLeft,null);
assert.equal((await catalogue('Eggs')).stockLeft,null);
console.log('PASS stock set: ADMIN/OWNER only, tenant isolation, validation, optimistic version, RLS on tables');

const payload=items=>({method:'STORE_PICKUP',mobile:'9876543210',paymentMethod:'CASH',items:items.map(([name,q])=>({productId:rows[name].p,preparationId:rows[name].prep,...(rows[name].basis==='RAW_WEIGHT'?{rawWeightGrams:q}:{quantity:q}),instructions:''}))});
const quote=p=>as(null,'select api.checkout_quote($1,$2) as value',[id(10),JSON.stringify(p)],'trait_checkout');
const end=new Date(Date.now()+86400000).toISOString();
async function place(p,q){const token=randomUUID().replaceAll('-','').repeat(2);return as(null,'select api.place_order($1,$2,$3,$4,$5,$6) as value',[id(10),randomUUID(),JSON.stringify(p),q.quoteDigest,createHash('sha256').update(token).digest('hex'),end],'trait_checkout');}

// Order deducts raw weight / trays atomically, aggregated per product.
let p=payload([['Fish',1000],['Eggs',2]]);
const first=await place(p,await quote(p));
assert.equal(await onHand('Fish'),2000);assert.equal(await onHand('Eggs'),1);
assert.equal((await catalogue('Fish')).stockLeft,2000);assert.equal((await catalogue('Eggs')).stockLeft,1);
// Insufficient stock rejects at quote and at placement (quote taken before stock dropped).
await assert.rejects(()=>quote(payload([['Eggs',2]])),e=>e.code==='22023'&&/Not enough stock for Eggs/.test(e.message));
p=payload([['Fish',1000]]);const staleQuote=await quote(p);
await query('update app.offering_stock set on_hand=500 where offering_id=$1',[rows.Fish.o]);
const before=await value('select count(*)::int as value from app.orders');
await assert.rejects(()=>place(p,staleQuote),e=>e.code==='22023'&&/Not enough stock for Fish/.test(e.message));
assert.equal(await value('select count(*)::int as value from app.orders'),before,'rejected order leaves nothing behind');
assert.equal(await onHand('Fish'),500);
// Below the smallest pack = sold out on the storefront; exactly the smallest pack still sells.
assert.equal((await catalogue('Fish')).available,true);assert.equal((await catalogue('Fish')).stockLeft,500);
p=payload([['Fish',500]]);await place(p,await quote(p));
assert.equal(await onHand('Fish'),0);assert.equal((await catalogue('Fish')).available,false);assert.equal((await catalogue('Fish')).stockLeft,null);
await assert.rejects(()=>quote(payload([['Fish',500]])),e=>e.code==='22023');
console.log('PASS order deducts stock, rejects oversell at quote and place, sold out at zero, low-stock hint');

// Cancelling restores; order detail shows stock impact; ledger is immutable and audited.
const order=await value('select row_to_json(o) as value from app.orders o where id=$1',[first.id]);
await as(21,"select api.transition_order($1,$2,'CANCELLED','Customer cancelled') as value",[first.id,order.version]);
assert.equal(await onHand('Fish'),1000);assert.equal(await onHand('Eggs'),3);
const detail=await as(22,'select api.order_detail($1) as value',[first.id]);
assert.deepEqual(detail.stock.map(m=>[m.kind,m.productName,m.change]).sort(),[['CANCEL_RESTORE','Eggs',2],['CANCEL_RESTORE','Fish',1000],['ORDER','Eggs',-2],['ORDER','Fish',-1000]]);
await assert.rejects(()=>query('delete from app.stock_movements'),/immutable/);
assert.equal(await value("select count(*)::int as value from app.audit_logs where action='STOCK_SET'"),2);
assert.equal(await value("select count(*)::int as value from app.stock_movements where kind='SET' and actor_id is not null"),2);
// Back to unlimited: blank clears the limit and the storefront hint.
await setStock('Fish',null);assert.equal((await row('Fish')).stock,null);
p=payload([['Fish',1000]]);await place(p,await quote(p));
assert.equal((await catalogue('Fish')).available,true);
// Defence in depth (priced units are already immutable): a count in the wrong unit never sells.
await setStock('Eggs',3);
await query("update app.offering_stock set measure='GRAMS' where offering_id=$1",[rows.Eggs.o]);
assert.equal((await row('Eggs')).stockNeedsRecount,true);assert.equal((await catalogue('Eggs')).available,false);
await assert.rejects(()=>quote(payload([['Eggs',1]])),e=>e.code==='22023');
console.log('PASS cancel restores stock, order detail stock impact, immutable ledger, audit, unlimited reset, unit change');
