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
 rows[name]={p,prep:await value('select preparation_option_id as value from app.product_preparation_options where product_id=$1',[p]),basis};
}
const start=new Date(Date.now()-86400000).toISOString(),end=new Date(Date.now()+86400000).toISOString();
const saveSQL='select api.save_offer($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) as value';
const save=(patch={},actor=21)=>{const o={id:null,store:id(10),version:null,title:'Offer',message:'',kind:'PERCENT',amount:1000,start,end,scope:'STORE',products:[],categories:[],active:true,code:'SAVE10',min:0,max:null,image:null,...patch};
 return as(actor,saveSQL,[o.id,o.store,o.version,o.title,o.message,o.kind,o.amount,o.start,o.end,o.scope,o.products,o.categories,o.active,o.code,o.min,o.max,o.image]);};
const line=(name,n)=>({productId:rows[name].p,preparationId:rows[name].prep,...(rows[name].basis==='RAW_WEIGHT'?{rawWeightGrams:n}:{quantity:n}),instructions:''});
const quote=(items,couponCode)=>as(null,'select api.checkout_quote($1,$2) as value',[id(10),JSON.stringify({method:'STORE_PICKUP',mobile:'9876543210',paymentMethod:'CASH',items,...(couponCode?{couponCode}:{})})],'trait_checkout');
const small=[line('Fish',500),line('Eggs',1)]; // ₹300 + ₹450 = ₹750
const big=[line('Fish',1000),line('Eggs',2)];  // ₹600 + ₹900 = ₹1,500

// Percent with a minimum and a cap.
const pct=await save({min:99900,max:10000});
await assert.rejects(()=>quote(small,'SAVE10'),/Coupon/); // ₹750 < ₹999
let q=await quote(big,'SAVE10');assert.equal(q.discountPaise,10000);assert.equal(q.totalPaise,140000); // 10% of ₹1,500 = ₹150, capped at ₹100
assert.equal(q.offer.minOrderPaise,99900);assert.equal(q.offer.maxDiscountPaise,10000);
await save({id:pct,version:1,min:99900,max:null});
q=await quote(big,'SAVE10');assert.equal(q.discountPaise,15000);
// The minimum counts only the offer's eligible items.
await save({title:'Fish',kind:'FIXED',amount:20000,code:'FISH200',scope:'PRODUCTS',products:[rows.Fish.p],min:50000});
await assert.rejects(()=>quote(small,'FISH200'),/Coupon/); // fish ₹300 < ₹500 even though the cart is ₹750
q=await quote(big,'FISH200');assert.equal(q.discountPaise,20000);
// Flat never exceeds the eligible amount.
await save({title:'Big flat',kind:'FIXED',amount:50000,code:'FLAT500',scope:'PRODUCTS',products:[rows.Fish.p]});
q=await quote(small,'FLAT500');assert.equal(q.discountPaise,30000);
// Whole rupees: 12.5% of ₹750 = ₹93.75 → ₹94.
await save({title:'Odd',amount:1250,code:'ODD'});
q=await quote(small,'ODD');assert.equal(q.discountPaise,9400);
console.log('PASS minimum on eligible subtotal, percent cap, flat capped at eligible amount, whole rupees');

// Validation and authorization.
await assert.rejects(()=>save({code:'BAD1',kind:'FIXED',amount:10000,max:5000}),e=>e.code==='22023'); // cap only for percent
await assert.rejects(()=>save({code:'BAD2',min:99950}),e=>e.code==='22023'); // whole rupees
await assert.rejects(()=>save({code:'BAD3',kind:'FIXED',amount:12345}),e=>e.code==='22023');
await assert.rejects(()=>save({code:'BAD4',max:0}),e=>e.code==='22023');
await assert.rejects(()=>save({code:'BAD5',min:-100}),e=>e.code==='22023');
const hash='a'.repeat(64);
await assert.rejects(()=>save({code:'IMG1',image:id(2)+'/'+hash+'.webp'}),e=>e.code==='22023'); // another business
await assert.rejects(()=>save({code:'IMG2',image:id(1)+'/../x.webp'}),e=>e.code==='22023');
const withImage=await save({code:'IMG3',image:id(1)+'/'+hash+'.webp'});
for(const actor of [22,23])await assert.rejects(()=>save({code:'NOPE'},actor),e=>e.code==='42501');
await assert.rejects(()=>query('update app.offers set image_path=$1 where id=$2',[id(2)+'/'+hash+'.webp',withImage]));
const current=await as(null,'select api.store_offers($1) as value',[id(10)],'anon');
const shown=current.find(o=>o.id===withImage);assert.equal(shown.imagePath,id(1)+'/'+hash+'.webp');assert.equal(shown.minOrderPaise,0);assert.equal(shown.maxDiscountPaise,null);
assert.equal(current.find(o=>o.id===pct).minOrderPaise,99900);
console.log('PASS validation, own-business images only, ADMIN/OWNER only, store_offers exposes conditions and image');

// Upload check: ADMIN and OWNER, own business folder only.
const can=(actor,name)=>as(actor,'select api.can_upload_offer_image($1) as value',[name]);
assert.equal(await can(20,id(1)+'/'+hash+'.webp'),true);  // ADMIN
assert.equal(await can(21,id(1)+'/'+hash+'.webp'),true);  // OWNER
assert.equal(await can(22,id(1)+'/'+hash+'.webp'),false); // EMPLOYEE
assert.equal(await can(23,id(1)+'/'+hash+'.webp'),false); // other business
assert.equal(await can(21,id(1)+'/x/'+hash+'.webp'),false);
assert.equal(await can(21,id(1)+'/'+hash+'.png'),false);
await assert.rejects(()=>as(null,'select api.can_upload_offer_image($1) as value',[id(1)+'/'+hash+'.webp'],'anon'),/permission denied/);
for(const role of ['anon','authenticated','service_role','trait_checkout'])assert.equal(await value("select has_table_privilege($1,'app.offers','SELECT,INSERT,UPDATE,DELETE') as value",[role]),false);
assert.equal(await value("select relrowsecurity and relforcerowsecurity as value from pg_class where oid='app.offers'::regclass"),true);
console.log('PASS offer image upload check and unchanged RLS');
await db.close();
