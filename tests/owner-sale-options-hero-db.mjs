// OWNER weight options + catalogue publish, homepage hero slides, and OWNER offers with a banner image.
// Run as ADMIN (20), OWNER (21), EMPLOYEE (22), another business's OWNER (23) and anon.
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
await query("insert into app.stores(id,business_id,code,name,address_line1,city,state,pickup_enabled) values($1,$2,'other','Other','Other street','Other city','Other state',true)",[id(11),id(2)]);
await query("insert into app.business_settings(business_id,employee_operational_history_days,require_payment_before_completion,max_order_items,max_order_total_paise) values($1,30,false,20,10000000)",[id(1)]);
for(const [n,b,role] of [[20,1,'OWNER'],[21,1,'OWNER'],[22,1,'EMPLOYEE'],[23,2,'OWNER']]){await query('insert into auth.users values($1)',[id(n)]);await query("insert into app.staff_profiles(id,business_id,auth_user_id,display_name,role) values($1,$2,$1,'Test',$3)",[id(n),id(b),role]);}
await query('insert into app.staff_admin_grants(staff_profile_id) values($1)',[id(20)]);
await query('insert into app.staff_store_assignments(business_id,store_id,staff_profile_id) values($1,$2,$3)',[id(1),id(10),id(22)]);
const deny=e=>e.code==='42501',invalid=e=>e.code==='22023',stale=e=>e.code==='40001';
const audits=action=>query('select actor_role,store_id,target_id,context from app.audit_logs where action=$1 order by created_at,id',[action]).then(r=>r.rows);
const category=await as(20,"select api.save_category(null,'Fish',null,0,true) as value");
const newProduct=async(name,basis,grams,count,quantities,price,published)=>{
 const p=await as(20,`select api.save_product(null,$1,$2,'','','','[500,1000]','[{"name":"Whole"},{"name":"Curry cut"}]',true) as value`,[category,name]);
 await as(20,'select api.configure_product_pricing($1,$2,$3,$4,$5,$6,$7) as value',[p,basis,grams,count,JSON.stringify(quantities),price,published]);
 return p;
};
const fish=await newProduct('Seer','RAW_WEIGHT',1000,null,[500,1000],60000,false);
const eggs=await newProduct('Eggs','TRAY',null,30,[1,2],45000,false);
const options=(actor,p,quantities,price,published)=>as(actor,'select api.save_product_sale_options($1,$2,$3,$4) as value',[p,quantities===undefined?null:JSON.stringify(quantities),price,published]);
const product=p=>query('select pricing_basis,price_unit_grams,units_per_pack,allowed_weights,sale_quantities,catalogue_price_paise,catalogue_published,preparations,category_id,name,is_active from app.products where id=$1',[p]).then(r=>r.rows[0]);
const offerings=p=>value('select count(*)::int as value from app.product_store_settings where product_id=$1',[p]);

// 1. OWNER: weight options + publish with catalogue price.
const seerBefore=await product(fish);
await options(21,fish,[250,500,1000,2000],65000,true);
let seer=await product(fish);
assert.deepEqual(seer.allowed_weights,[250,500,1000,2000]);assert.deepEqual(seer.sale_quantities,[]);
assert.deepEqual([seer.catalogue_price_paise,seer.catalogue_published],[65000,true]);
// Pricing basis, cuts, category, name and status unchanged.
for(const k of ['pricing_basis','price_unit_grams','units_per_pack','preparations','category_id','name','is_active'])assert.deepEqual(seer[k],seerBefore[k],k);
assert.deepEqual((await query('select raw_weight_grams from app.product_allowed_weights where product_id=$1 and is_active order by sort_order',[fish])).rows.map(r=>r.raw_weight_grams),[250,500,1000,2000]);
assert.equal(await offerings(fish),1); // publishing created the store offering at the catalogue price
assert.equal(await value('select pr.price_per_kg_paise as value from app.product_prices pr join app.product_store_settings o on o.id=pr.offering_id where o.product_id=$1',[fish]),65000);
const storefront=await as(null,'select api.catalogue($1) as value',[id(10)],'anon');
assert.deepEqual(storefront.products.find(p=>p.id===fish).weightsGrams,[250,500,1000,2000]);
assert.ok((await as(null,'select api.business_catalogue($1) as value',[id(1)],'anon')).products.some(p=>p.id===fish));
// Tray product: sale quantities; unpublish keeps the price, leaves the business catalogue, offering untouched.
await options(21,eggs,[1,2,3,6],47000,true);
await options(21,eggs,[1,2,3,6],47000,false);
const tray=await product(eggs);
assert.deepEqual([tray.sale_quantities,tray.allowed_weights,tray.catalogue_published,tray.catalogue_price_paise,tray.units_per_pack],[[1,2,3,6],[],false,47000,30]);
assert.ok(!(await as(null,'select api.business_catalogue($1) as value',[id(1)],'anon')).products.some(p=>p.id===eggs));
assert.equal(await offerings(eggs),1);
// Re-publishing does not add a second offering or change the store price.
await options(21,fish,[500,1000],70000,true);
assert.equal(await offerings(fish),1);
assert.equal(await value('select count(*)::int as value from app.product_prices pr join app.product_store_settings o on o.id=pr.offering_id where o.product_id=$1',[fish]),1);
// Invalid input refused.
for(const [q,price,pub] of [[[],65000,true],[[0],65000,true],[[500,500],65000,true],[[1.5],65000,true],[['500'],65000,true],[[500],null,true],[[500],0,true],[[500],100000001,false],[[500],65000,null],[undefined,65000,true],[Array.from({length:51},(_,i)=>i+1),65000,false]])
 await assert.rejects(()=>options(21,fish,q,price,pub),e=>invalid(e)||e.code==='23514'||e.code==='22004',JSON.stringify([q,price,pub]));
await options(21,fish,[500],null,false); // unpublished without a price is allowed
// EMPLOYEE, another business and anon are refused; nothing changes.
const snapshot=JSON.stringify(await product(fish));
for(const actor of [22,23])await assert.rejects(()=>options(actor,fish,[500,1000],65000,true),deny);
await assert.rejects(()=>as(null,'select api.save_product_sale_options($1,$2,$3,$4) as value',[fish,'[500]',1,true],'anon'));
assert.equal(JSON.stringify(await product(fish)),snapshot);
// Pricing basis, cuts, categories, create and delete stay ADMIN-only.
await assert.rejects(()=>as(21,'select api.configure_product_pricing($1,$2,$3,$4,$5,$6,true) as value',[fish,'NET_WEIGHT',500,null,'[500]',1]),deny);
await assert.rejects(()=>as(21,`select api.save_product($1,$2,'Seer','','','','[500]','[{"name":"Whole"}]',false) as value`,[fish,category]),deny);
await assert.rejects(()=>as(21,`select api.save_product(null,$1,'New','','','','[500]','[{"name":"Whole"}]',true) as value`,[category]),deny);
await assert.rejects(()=>as(21,"select api.save_category(null,'Mutton',null,1,true) as value"),deny);
await assert.rejects(()=>as(21,'select api.catalogue_master() as value'),deny);
// product_content gives OWNER the sale fields; EMPLOYEE refused.
const listed=(await as(21,'select api.product_content() as value')).find(p=>p.id===eggs);
assert.deepEqual([listed.pricing_basis,listed.quantities,listed.units_per_pack,listed.catalogue_price_paise,listed.catalogue_published],['TRAY',[1,2,3,6],30,47000,false]);
await assert.rejects(()=>as(22,'select api.product_content() as value'),deny);
// Audit: every save, with role and from/to.
const saleAudit=await audits('PRODUCT_SALE_OPTIONS_SAVED');
assert.equal(saleAudit.length,5);assert.ok(saleAudit.every(a=>a.actor_role==='OWNER'&&a.store_id===null));
assert.deepEqual(saleAudit[0].context.quantities,{from:[500,1000],to:[250,500,1000,2000]});
assert.deepEqual(saleAudit[0].context.referencePricePaise,{from:60000,to:65000});
assert.deepEqual(saleAudit[0].context.published,{from:false,to:true});
assert.equal(saleAudit[0].context.offeringsCreated.length,1);assert.equal(saleAudit[3].context.offeringsCreated.length,0);
console.log('PASS OWNER edits weight options and publishes/unpublishes at the catalogue price (offering created once, audited); basis, cuts, categories, create/retire stay ADMIN-only; EMPLOYEE/other business/anon refused');

// 2. Hero slides.
const hash=c=>c.repeat(64);
const path=(c,b=id(1),s=id(10))=>`${b}/${s}/${hash(c)}.webp`;
const add=(actor,p,width=1920,size=500000,alt='Fresh fish',store=id(10))=>as(actor,'select api.add_hero_slide($1,$2,$3,$4,$5) as value',[store,p,width,size,alt]);
const published=()=>as(null,'select api.hero_slides($1) as value',[id(10)],'anon');
const settings=actor=>as(actor,'select api.hero_slide_settings($1) as value',[id(10)]);
assert.deepEqual(await published(),[]);
const a=await add(21,path('a'));const b=await add(20,path('b'),1600,1048576);const c=await add(21,path('c'));
assert.deepEqual((await published()).map(s=>s.path),[path('a'),path('b'),path('c')]);
assert.deepEqual(Object.keys((await published())[0]).sort(),['alt','path']);
// Server-side rules: width >= 1600, <= 1 MB, own business/store path, WebP name, no duplicates, max 5.
await assert.rejects(()=>add(21,path('d'),1599),invalid);
await assert.rejects(()=>add(21,path('d'),1920,1048577),invalid);
await assert.rejects(()=>add(21,path('d'),1920,0),invalid);
await assert.rejects(()=>add(21,path('d',id(2))),invalid);
await assert.rejects(()=>add(21,path('d',id(1),id(11))),invalid); // path under another store
await assert.rejects(()=>add(21,path('d',id(2),id(11)),1920,500000,'',id(11)),deny); // another business's store
await assert.rejects(()=>add(21,path('d').replace('.webp','.png')),invalid);
await assert.rejects(()=>add(21,`${id(1)}/${id(10)}/../${hash('d')}.webp`),invalid);
await assert.rejects(()=>add(21,path('d'),1920,1000,'<script>'),invalid);
await assert.rejects(()=>add(21,path('a')),invalid);
await add(21,path('d'));await add(21,path('e'));
await assert.rejects(()=>add(21,path('f')),e=>invalid(e)&&/at most 5/.test(e.message));
// Reorder: the full active set only.
const ids=(await settings(21)).map(s=>s.id);
await as(21,'select api.arrange_hero_slides($1,$2) as value',[id(10),[ids[2],ids[0],ids[1],ids[4],ids[3]]]);
assert.deepEqual((await published()).map(s=>s.path),[path('c'),path('a'),path('b'),path('e'),path('d')]);
await assert.rejects(()=>as(21,'select api.arrange_hero_slides($1,$2) as value',[id(10),ids.slice(0,4)]),stale);
await assert.rejects(()=>as(21,'select api.arrange_hero_slides($1,$2) as value',[id(10),[ids[0],ids[0],ids[1],ids[2],ids[3]]]),stale);
// Remove is soft: hidden from the homepage, row kept, the gap closes and a new slide may be added.
await as(21,'select api.remove_hero_slide($1,$2) as value',[id(10),a]);
assert.deepEqual((await published()).map(s=>s.path),[path('c'),path('b'),path('e'),path('d')]);
const removed=(await query('select is_active,removed_at,removed_by from app.store_hero_slides where id=$1',[a])).rows[0];
assert.deepEqual([removed.is_active,!!removed.removed_at,removed.removed_by],[false,true,id(21)]);
assert.deepEqual((await query('select sort_order from app.store_hero_slides where store_id=$1 and is_active order by sort_order',[id(10)])).rows.map(r=>r.sort_order),[0,1,2,3]);
await assert.rejects(()=>as(21,'select api.remove_hero_slide($1,$2) as value',[id(10),a]),stale);
await add(21,path('a')); // the same photo can come back after removal
assert.equal((await published()).length,5);
assert.equal(await value('select count(*)::int as value from app.store_hero_slides'),6); // nothing deleted
// EMPLOYEE, other business and anon refused everywhere.
for(const actor of [22,23]){
 await assert.rejects(()=>add(actor,path('f')),deny);
 await assert.rejects(()=>settings(actor),deny);
 await assert.rejects(()=>as(actor,'select api.arrange_hero_slides($1,$2) as value',[id(10),ids]),deny);
 await assert.rejects(()=>as(actor,'select api.remove_hero_slide($1,$2) as value',[id(10),b]),deny);
}
await assert.rejects(()=>as(null,'select api.hero_slide_settings($1) as value',[id(10)],'anon'));
await assert.rejects(()=>as(null,'select api.add_hero_slide($1,$2,1920,1000,$3) as value',[id(10),path('f'),''],'anon'));
// Storage upload check: ADMIN/OWNER, own business, accessible store, WebP name.
const canUpload=(actor,name)=>as(actor,'select api.can_upload_hero_image($1) as value',[name]);
assert.equal(await canUpload(21,path('f')),true);assert.equal(await canUpload(20,path('f')),true);
assert.equal(await canUpload(22,path('f')),false);assert.equal(await canUpload(23,path('f')),false);
assert.equal(await canUpload(21,path('f',id(2),id(11))),false);assert.equal(await canUpload(21,path('f',id(1),id(999))),false);
assert.equal(await canUpload(21,path('f').replace('.webp','.jpg')),false);
// Tables closed; inactive store publishes nothing; audited.
for(const role of ['anon','authenticated','service_role'])for(const priv of ['SELECT','INSERT','UPDATE','DELETE'])
 assert.equal(await value("select has_table_privilege($1,'app.store_hero_slides',$2) as value",[role,priv]),false);
assert.equal(await value("select relrowsecurity and relforcerowsecurity as value from pg_class where oid='app.store_hero_slides'::regclass"),true);
for(const [fn,anon] of [['api.hero_slides(uuid)',true],['api.add_hero_slide(uuid,text,integer,integer,text)',false],['api.arrange_hero_slides(uuid,uuid[])',false],['api.remove_hero_slide(uuid,uuid)',false],['api.hero_slide_settings(uuid)',false],['api.save_product_sale_options(uuid,jsonb,bigint,boolean)',false]])
 assert.equal(await value("select has_function_privilege('anon',$1,'EXECUTE') as value",[fn]),anon,fn);
assert.deepEqual([(await audits('HERO_SLIDE_ADDED')).length,(await audits('HERO_SLIDES_ARRANGED')).length,(await audits('HERO_SLIDE_REMOVED')).length],[6,1,1]);
const added=(await audits('HERO_SLIDE_ADDED'))[1];assert.deepEqual([added.actor_role,added.store_id,added.context.width,added.context.sizeBytes],['ADMIN',id(10),1600,1048576]);
assert.equal((await audits('HERO_SLIDE_REMOVED'))[0].actor_role,'OWNER');
await query('update app.stores set is_active=false where id=$1',[id(10)]);
assert.deepEqual(await published(),[]);
await query('update app.stores set is_active=true where id=$1',[id(10)]);
console.log('PASS hero slides: ADMIN/OWNER add (>=1600px, <=1 MB, own store path, max 5), reorder, soft remove; EMPLOYEE/other business/anon refused; closed table, audited');

// 3. OWNER Offers: workspace visible with offers, banner upload allowed and saved; EMPLOYEE sees current offers only.
const start=new Date(Date.now()-86400000).toISOString(),end=new Date(Date.now()+86400000).toISOString();
const banner=`${id(1)}/${hash('9')}.webp`;
assert.equal(await as(21,'select api.can_upload_offer_image($1) as value',[banner]),true);
assert.equal(await as(22,'select api.can_upload_offer_image($1) as value',[banner]),false);
const offer=await as(21,'select api.save_offer(null,$1,null,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,$11,0,null,$12) as value',[id(10),'Weekend','','PERCENT',1000,start,end,'STORE',[],[],'OWNER10',banner]);
const ws=await as(21,'select api.offer_workspace($1) as value',[id(10)]);
assert.equal(ws.offers.find(o=>o.id===offer).image_path,banner);
assert.equal((await as(22,'select api.offer_workspace($1) as value',[id(10)])).offers,undefined);
await assert.rejects(()=>as(22,'select api.save_offer(null,$1,null,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,$11,0,null,null) as value',[id(10),'X','','PERCENT',1000,start,end,'STORE',[],[],'EMP10']),deny);
console.log('PASS OWNER offers: workspace lists offers, banner upload check allows OWNER (not EMPLOYEE), save with image; EMPLOYEE read-only');
await db.close();
