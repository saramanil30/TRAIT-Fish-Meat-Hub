process.on('uncaughtException',e=>{console.error(e.message,e.code??'',e.position??'',e.where??'');process.exit(1);});
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
const category=await as(20,"select api.save_category(null,'Test',null,0,true) as value");
const rows=[];
for(const [name,basis,grams,count,quantities,price] of [['Raw','RAW_WEIGHT',1000,null,[500,1000],160000],['King Fish','NET_WEIGHT',500,null,[500,1000],80000],['Eggs','TRAY',null,30,[1,2],45000],['Unit','UNIT',null,1,[1,2],100]]){
 const p=await as(20,`select api.save_product(null,$1,$2,'','','','[500,1000]','[{"name":"Whole"}]',true) as value`,[category,name]);
 await as(20,'select api.configure_product_pricing($1,$2,$3,$4,$5,$6,true) as value',[p,basis,grams,count,JSON.stringify(quantities),price]);
 for(const actor of [21,22,23])await assert.rejects(()=>as(actor,'select api.configure_product_pricing($1,$2,$3,$4,$5,$6,true) as value',[p,basis,grams,count,JSON.stringify(quantities),1]),e=>e.code==='42501');
 const o=await as(20,'select api.create_offering($1,$2) as value',[p,id(10)]);
 await as(21,'select api.update_daily_product($1,1,$2,true) as value',[o,price]);
 const prep=await value('select preparation_option_id as value from app.product_preparation_options where product_id=$1',[p]);
 rows.push({p,o,prep,basis,price,quantity:quantities[0]});
}
console.log('PASS ADMIN configures exact price units; OWNER/EMPLOYEE/foreign ADMIN cannot');
const publicData=await as(null,'select api.catalogue($1) as value',[id(10)],'anon');
assert.equal(publicData.products.length,4);
const king=publicData.products.find(p=>p.name==='King Fish');assert.equal(king.pricePaise,80000);assert.equal(king.priceUnitGrams,500);assert.equal(king.pricePerKgPaise,null);assert.deepEqual(king.weightsGrams,null);
const eggs=publicData.products.find(p=>p.name==='Eggs');assert.equal(eggs.unitsPerPack,30);assert.equal(eggs.pricePaise,45000);
const reference=await as(null,'select api.business_catalogue($1) as value',[id(1)],'anon');assert.equal(reference.products.length,4);assert.ok(reference.products.every(p=>p.orderable===false));
const payload={method:'STORE_PICKUP',mobile:'9876543210',paymentMethod:'CASH',items:rows.map(r=>({productId:r.p,preparationId:r.prep,...(r.basis==='RAW_WEIGHT'?{rawWeightGrams:r.quantity}:{quantity:r.quantity}),instructions:''}))};
const quote=p=>as(null,'select api.checkout_quote($1,$2) as value',[id(10),JSON.stringify(p)],'trait_checkout');
const quoted=await quote(payload);assert.equal(quoted.totalPaise,205100);assert.deepEqual(quoted.items.map(i=>i.lineTotalPaise),[80000,80000,45000,100]);
assert.equal(quoted.items[1].rawWeightGrams,null);assert.equal(quoted.items[2].rawWeightGrams,null);assert.equal(quoted.items[1].snapshot.estimatedCleanedWeightGrams,null);
for(const item of [{...payload.items[1],quantity:undefined,rawWeightGrams:500},{...payload.items[2],quantity:30},{...payload.items[2],pricePaise:1},{...payload.items[0],quantity:500}])await assert.rejects(()=>quote({...payload,items:[item]}));
console.log('PASS raw/kg unchanged; exact 500g NET and 30-egg tray; forged units/prices rejected');
const args=[id(10),randomUUID(),JSON.stringify(payload),quoted.quoteDigest,createHash('sha256').update(randomUUID()).digest('hex'),new Date(Date.now()+86400000).toISOString()];
const place=()=>as(null,'select api.place_order($1,$2,$3,$4,$5,$6) as value',args,'trait_checkout');
const order=await place();assert.equal((await place()).id,order.id);
const stored=(await query('select * from app.order_items where order_id=$1 order by line_number',[order.id])).rows;
assert.equal(stored[1].unit_price_paise,80000);assert.equal(stored[1].price_per_kg_paise,null);assert.equal(stored[1].sale_quantity,500);assert.equal(stored[2].sale_quantity,1);assert.equal(stored[2].units_per_pack,30);assert.equal(stored[2].raw_weight_grams,null);
await assert.rejects(()=>query('update app.order_items set sale_quantity=2 where id=$1',[stored[2].id]));
await assert.rejects(()=>as(20,'select api.configure_product_pricing($1,\'RAW_WEIGHT\',1000,null,\'[500]\',1,true) as value',[rows[2].p]));
for(const r of rows){await assert.rejects(()=>as(22,'select api.update_daily_product($1,2,1,false) as value',[r.o]),e=>e.code==='42501');}
await as(21,'select api.update_daily_product($1,2,46000,false) as value',[rows[2].o]);
await assert.rejects(()=>quote(payload));
assert.equal((await place()).id,order.id);
const daily=await as(21,'select api.daily_products($1) as value',[id(10)]);assert.equal(daily.find(p=>p.name==='Eggs').pricePaise,46000);
assert.equal(await value("select count(*)::int as value from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='app' and c.relkind='r' and (not relrowsecurity or not relforcerowsecurity)"),0);
for(const role of ['anon','authenticated','service_role','trait_checkout','trait_payment_verifier'])assert.equal(await value("select count(*)::int as value from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='app' and c.relkind='r' and has_table_privilege($1,c.oid,'SELECT,INSERT,UPDATE,DELETE')",[role]),0);
console.log('PASS exact immutable snapshots, replay after price changes, OWNER price/stock only, EMPLOYEE denial and forced RLS');
await db.close();
