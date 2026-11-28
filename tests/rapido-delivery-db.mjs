// Replays migrations: per-pincode delivery mode (shop fee or Rapido), advance payment, and the ADMIN/OWNER Rapido tracking link.
process.on('uncaughtException',e=>{console.error('FAIL',e.message,e.code??'',e.where??'');process.exit(1);});
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
await query("insert into app.stores(id,business_id,code,name,address_line1,city,state,pickup_enabled,delivery_enabled) values($1,$2,'test','Test','Test street','Test city','Test state',true,true)",[id(10),id(1)]);
await query("insert into app.business_settings(business_id,employee_operational_history_days,require_payment_before_completion,max_order_items,max_order_total_paise) values($1,30,false,20,10000000)",[id(1)]);
for(const [n,role] of [[20,'OWNER'],[21,'OWNER'],[22,'EMPLOYEE']]){await query('insert into auth.users values($1)',[id(n)]);await query("insert into app.staff_profiles(id,business_id,auth_user_id,display_name,role) values($1,$2,$1,'Test',$3)",[id(n),id(1),role]);}
await query('insert into app.staff_admin_grants(staff_profile_id) values($1)',[id(20)]);
await query('insert into app.staff_store_assignments(business_id,store_id,staff_profile_id) values($1,$2,$3)',[id(1),id(10),id(22)]);
const category=await as(20,"select api.save_category(null,'Test',null,0,true) as value");
const p=await as(20,`select api.save_product(null,$1,'Fish','','','','[500,1000]','[{"name":"Whole"}]',true) as value`,[category]);
await as(20,"select api.configure_product_pricing($1,'RAW_WEIGHT',1000,null,'[500,1000]',60000,true) as value",[p]);
const o=await value('select id as value from app.product_store_settings where product_id=$1',[p]);
await as(21,'select api.update_daily_product($1,$2,60000,true) as value',[o,await value('select version as value from app.product_store_settings where id=$1',[o])]);
const prep=await value('select preparation_option_id as value from app.product_preparation_options where product_id=$1',[p]);

// Settings: ADMIN/OWNER only; a Rapido rule always stores fee 0; advance and estimate only for Rapido.
const save=(who,a)=>as(who,'select api.save_delivery_area($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) as value',[a.id??null,id(10),a.version??null,a.pincode,a.name,a.fee,0,true,a.mode,a.estimate??null,a.advance??false]);
await save(20,{pincode:'500075',name:'Kokapet',fee:4000,mode:'SHOP',estimate:'ignored',advance:true});
await save(21,{pincode:'500032',name:'Gachibowli',fee:9900,mode:'RAPIDO',estimate:'approx ₹60–150, paid separately',advance:false});
await save(21,{pincode:'500081',name:'Madhapur',fee:0,mode:'RAPIDO',estimate:'approx ₹80–180, paid separately',advance:true});
const area=pin=>value("select to_jsonb(d) as value from app.delivery_areas d where pincode=$1",[pin]);
assert.deepEqual([(await area('500075')).delivery_mode,(await area('500075')).rapido_estimate,(await area('500075')).advance_payment_required],['SHOP',null,false]);
assert.deepEqual([(await area('500032')).delivery_fee_paise,(await area('500032')).rapido_estimate],[0,'approx ₹60–150, paid separately']);
await assert.rejects(()=>save(22,{pincode:'500084',name:'Kondapur',fee:0,mode:'RAPIDO'}),e=>e.code==='42501');
await assert.rejects(()=>save(20,{pincode:'500084',name:'Kondapur',fee:0,mode:'BIKE'}),e=>e.code==='22023');
await assert.rejects(()=>save(20,{pincode:'500084',name:'Kondapur',fee:0,mode:'RAPIDO',estimate:'<script>'}),e=>e.code==='22023');
const info=await as(null,'select api.storefront_info($1) as value',[id(10)],'anon');
assert.deepEqual(info.areas.map(a=>[a.pincode,a.mode,a.advanceRequired]),[['500032','RAPIDO',false],['500075','SHOP',false],['500081','RAPIDO',true]]);
console.log('PASS settings: ADMIN/OWNER only, Rapido fee forced to 0, estimate validated, published in storefront_info');

// Checkout: Rapido adds 0 to our total and the rule rides on the quote; advance-required rejects cash.
const payload=(pin,pay)=>({method:'HOME_DELIVERY',mobile:'9876543210',name:'Asha',paymentMethod:pay,address:{line1:'Flat 1',locality:'X',city:'Hyderabad',state:'Telangana',pincode:pin},items:[{productId:p,preparationId:prep,rawWeightGrams:1000,instructions:''}]});
const quote=x=>as(null,'select api.checkout_quote($1,$2) as value',[id(10),JSON.stringify(x)],'trait_checkout');
const shop=await quote(payload('500075','CASH'));
assert.deepEqual([shop.deliveryFeePaise,shop.totalPaise,shop.fulfillment.deliveryRule.mode],[4000,64000,'SHOP']);
const rapido=await quote(payload('500032','CASH'));
assert.deepEqual([rapido.deliveryFeePaise,rapido.totalPaise,rapido.fulfillment.deliveryRule.mode,rapido.fulfillment.deliveryRule.rapidoEstimate],[0,60000,'RAPIDO','approx ₹60–150, paid separately']);
await assert.rejects(()=>quote(payload('500081','CASH')),e=>e.code==='22023'&&/Advance payment required/.test(e.message));
const upi=await quote(payload('500081','UPI'));
assert.equal(upi.fulfillment.deliveryRule.advanceRequired,true);
console.log('PASS checkout: shop fee unchanged, Rapido fee 0 with its note, advance-required area refuses cash');

const end=new Date(Date.now()+86400000).toISOString();
async function place(x){const q=await quote(x);const token=randomUUID().replaceAll('-','').repeat(2);const r=await as(null,'select api.place_order($1,$2,$3,$4,$5,$6) as value',[id(10),randomUUID(),JSON.stringify(x),q.quoteDigest,createHash('sha256').update(token).digest('hex'),end],'trait_checkout');return {...r,token};}
const rOrder=await place(payload('500081','UPI')), sOrder=await place(payload('500075','CASH'));
const track=t=>as(null,'select api.track_order($1) as value',[t],'anon');
let t=await track(rOrder.token);
assert.deepEqual([t.deliveryMode,t.rapidoEstimate,t.advanceRequired,t.rapidoTrackingUrl,t.deliveryFeePaise],['RAPIDO','approx ₹80–180, paid separately',true,null,0]);
assert.equal((await track(sOrder.token)).deliveryMode,'SHOP');
// Changing the area later does not change the placed order's note.
const m=await area('500081');
await as(20,'select api.save_delivery_area($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) as value',[m.id,id(10),m.version,'500081','Madhapur',5000,0,true,'SHOP',null,false]);
assert.equal((await track(rOrder.token)).rapidoEstimate,'approx ₹80–180, paid separately');
console.log('PASS orders: tracking shows mode, note and advance from the order snapshot');

// Tracking link: ADMIN/OWNER only, https only, Rapido orders only, audited; table closed to every client role.
const link='https://rapido.bike/share/abc123?ref=1';
const setLink=(who,order,url)=>as(who,'select api.set_rapido_tracking($1,$2) as value',[order,url]);
await assert.rejects(()=>setLink(22,rOrder.id,link),e=>e.code==='42501');
await assert.rejects(()=>as(null,'select api.set_rapido_tracking($1,$2) as value',[rOrder.id,link],'anon'),/permission denied/);
await assert.rejects(()=>as(null,'select api.set_rapido_tracking($1,$2) as value',[rOrder.id,link],'trait_checkout'),/permission denied/);
for(const bad of ['http://rapido.bike/x','javascript:alert(1)','https://rapido.bike/a b','https://x/"><script>'])await assert.rejects(()=>setLink(21,rOrder.id,bad),e=>e.code==='22023');
await assert.rejects(()=>setLink(21,sOrder.id,link),e=>e.code==='22023'&&/Not a Rapido/.test(e.message));
await setLink(21,rOrder.id,link);
assert.equal((await track(rOrder.token)).rapidoTrackingUrl,link);
assert.equal((await as(20,'select api.order_detail($1) as value',[rOrder.id])).rapidoTrackingUrl,link);
await setLink(20,rOrder.id,'https://rapido.bike/share/new');
assert.equal((await track(rOrder.token)).rapidoTrackingUrl,'https://rapido.bike/share/new');
await setLink(20,rOrder.id,'  ');
assert.equal((await track(rOrder.token)).rapidoTrackingUrl,null);
assert.equal(await value("select count(*)::int as value from app.audit_logs where action='RAPIDO_TRACKING_SET'"),3);
for(const role of ['anon','authenticated','trait_checkout','trait_payment_verifier'])await assert.rejects(async()=>{await db.exec('SET ROLE '+role);try{await query('select * from app.order_rapido_tracking');}finally{await db.exec('RESET ROLE');}},/permission denied/);
console.log('PASS tracking link: ADMIN/OWNER only, https only, Rapido orders only, audited, table closed');
