// Replays migrations: Track Order lookup by mobile returns open orders only, status data only, server role only.
process.on('uncaughtException',e=>{console.error('FAIL',e.message,e.code??'');process.exit(1);});
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
await query("insert into app.businesses(id,slug,display_name) values($1,'test','Test')",[id(1)]);
await query("insert into app.stores(id,business_id,code,name,address_line1,city,state,pickup_enabled) values($1,$2,'test','Test','Test street','Test city','Test state',true)",[id(10),id(1)]);
await query("insert into app.business_settings(business_id,employee_operational_history_days,require_payment_before_completion,max_order_items,max_order_total_paise) values($1,30,false,20,10000000)",[id(1)]);
await query('insert into auth.users values($1)',[id(20)]);
await query("insert into app.staff_profiles(id,business_id,auth_user_id,display_name,role) values($1,$2,$1,'Test','OWNER')",[id(20),id(1)]);
await query('insert into app.staff_admin_grants(staff_profile_id) values($1)',[id(20)]);
const category=await as(20,"select api.save_category(null,'Test',null,0,true) as value");
const product=await as(20,`select api.save_product(null,$1,'Raw','','','','[500,1000]','[{"name":"Whole"}]',true) as value`,[category]);
await as(20,"select api.configure_product_pricing($1,'RAW_WEIGHT',1000,null,'[500,1000]',160000,true) as value",[product]);
const prep=await value('select preparation_option_id as value from app.product_preparation_options where product_id=$1',[product]);
const expires=new Date(Date.now()+86400000).toISOString();
async function order(mobile){
 const payload={method:'STORE_PICKUP',mobile,name:'Private Name',paymentMethod:'CASH',items:[{productId:product,preparationId:prep,rawWeightGrams:500,instructions:'private note'}]};
 const q=await as(null,'select api.checkout_quote($1,$2) as value',[id(10),JSON.stringify(payload)],'trait_checkout');
 const token=randomUUID().replaceAll('-','').repeat(2);
 const placed=await as(null,'select api.place_order($1,$2,$3,$4,$5,$6) as value',[id(10),randomUUID(),JSON.stringify(payload),q.quoteDigest,createHash('sha256').update(token).digest('hex'),expires],'trait_checkout');
 return {...placed,token};
}
const first=await order('9876543210'), second=await order('+91 98765-43210'), cancelled=await order('9876543210'), other=await order('9123456780');
await as(20,"select api.transition_order($1,1,'CANCELLED','Customer asked') as value",[cancelled.id]);
await as(20,"select api.transition_order($1,1,'CONFIRMED',null) as value",[first.id]);
const lookup=(mobile,role='trait_checkout')=>as(null,'select api.open_orders_by_mobile($1,$2) as value',[id(10),mobile],role);

const found=await lookup('+919876543210');
assert.equal(found.length,2);
const numberOf=o=>value('select order_number as value from app.orders where id=$1',[o.id]);
assert.deepEqual(new Set(found.map(o=>o.orderNumber)),new Set([await numberOf(first),await numberOf(second)]));
console.log('PASS open orders for the number (cancelled excluded, other numbers excluded)');
for(const o of found)assert.deepEqual(Object.keys(o).sort(),['history','orderNumber','placedAt','status','totalPaise']);
const text=JSON.stringify(found);
for(const secret of ['Private Name','private note','9876543210',first.token,first.id])assert.ok(!text.includes(secret),'leaked '+secret);
assert.deepEqual(found.find(o=>o.status==='CONFIRMED').history.map(h=>h.status),['PLACED','CONFIRMED']);
console.log('PASS only number, date, status, total and timeline; no name, items, mobile, ids or tokens');
assert.deepEqual(await lookup('0000000000'),[]); assert.deepEqual(await lookup('not a number'),[]); assert.deepEqual(await lookup('9000000000'),[]);
console.log('PASS invalid or unknown numbers return an empty list (no error to distinguish them)');
for(const role of ['anon','authenticated'])await assert.rejects(()=>lookup('9876543210',role),e=>e.code==='42501');
console.log('PASS anon and authenticated cannot call the lookup (server checkout role only)');
assert.equal((await as(null,'select api.track_order($1) as value',[first.token],'anon')).status,'CONFIRMED');
console.log('PASS private tracking links still work');
