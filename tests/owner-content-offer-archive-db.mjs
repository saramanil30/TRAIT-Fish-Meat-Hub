// OWNER product content (photo, local name, description) and offer archive / restore / stop, as ADMIN, OWNER and EMPLOYEE.
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
const fish=rows.Fish.p,deny=e=>e.code==='42501';
const audits=a=>value("select count(*)::int as value from app.audit_logs where action=$1",[a]);
// 1. Product content: ADMIN (20) and OWNER (21) of their own business; EMPLOYEE (22) and another business (23) refused.
const content=(actor,p=fish,local='Vanjaram',desc='Fresh daily')=>as(actor,'select api.save_product_content($1,$2,$3) as value',[p,local,desc]);
await content(21,fish,' Vanjaram ','Owner text');
const product=(await query('select local_name,description,name,is_active from app.products where id=$1',[fish])).rows[0];
assert.deepEqual([product.local_name,product.description,product.name,product.is_active],['Vanjaram','Owner text','Fish',true]);
await content(20,fish,'Admin local','Admin text');
for(const actor of [22,23])await assert.rejects(()=>content(actor),deny);
await assert.rejects(()=>as(null,'select api.save_product_content($1,$2,$3) as value',[fish,'x','y'],'anon'));
await assert.rejects(()=>content(21,fish,'x'.repeat(161)));
const audit=(await query("select actor_role,store_id,context from app.audit_logs where action='PRODUCT_CONTENT_SAVED' order by created_at")).rows;
assert.equal(audit.length,2);assert.equal(audit[0].actor_role,'OWNER');assert.equal(audit[0].store_id,null);
assert.deepEqual(audit[0].context.localName,{from:'',to:'Vanjaram'});assert.deepEqual(audit[1].context.description,{from:'Owner text',to:'Admin text'});
// Everything else stays ADMIN-only for OWNER.
await assert.rejects(()=>as(21,`select api.save_product($1,$2,'Renamed','','','','[500,1000]','[{"name":"Whole"}]',false) as value`,[fish,category]),deny);
await assert.rejects(()=>as(21,'select api.configure_product_pricing($1,$2,$3,$4,$5,$6,true) as value',[fish,'RAW_WEIGHT',1000,null,'[500]',1]),deny);
await assert.rejects(()=>as(21,"select api.save_product_image(null,$1,null,'product-images',$2,'',true,true,0) as value",[fish,`${id(1)}/${fish}/${'a'.repeat(64)}.webp`]),deny);
await assert.rejects(()=>as(21,'select api.catalogue_master() as value'),deny);
const list=await as(21,'select api.product_content() as value');
assert.equal(list.length,2);assert.deepEqual(Object.keys(list[0]).sort(),['category','description','id','image_path','is_active','local_name','name','photo']);
await assert.rejects(()=>as(22,'select api.product_content() as value'),deny);
assert.equal((await as(23,'select api.product_content() as value')).length,0);
console.log('PASS OWNER edits local name and description (audited from/to); other product fields, images and master stay ADMIN-only; EMPLOYEE refused');
// Photo: upload check and set_product_photo for ADMIN/OWNER, own business and product only.
const path=(b=id(1),p=fish,h='b')=>`${b}/${p}/${h.repeat(64)}.webp`;
const canUpload=(actor,name)=>as(actor,'select api.can_upload_product_image($1) as value',[name]);
assert.equal(await canUpload(21,path()),true);assert.equal(await canUpload(20,path()),true);
assert.equal(await canUpload(22,path()),false);assert.equal(await canUpload(23,path()),false);
assert.equal(await canUpload(21,path(id(2))),false);assert.equal(await canUpload(21,path(id(1),id(999))),false);assert.equal(await canUpload(21,path().replace('.webp','.png')),false);
const photo=(actor,name=path(),p=fish)=>as(actor,'select api.set_product_photo($1,$2,$3) as value',[p,name,'Fish']);
await photo(21);await photo(20,path(id(1),fish,'c'));
assert.equal(await value("select count(*)::int as value from app.product_images where product_id=$1 and is_primary",[fish]),1);
assert.equal((await as(21,'select api.product_content() as value')).find(p=>p.id===fish).photo,path(id(1),fish,'c'));
for(const actor of [22,23])await assert.rejects(()=>photo(actor),deny);
await assert.rejects(()=>photo(21,path(id(1),rows.Eggs.p)),e=>e.code==='22023'); // another product's path
await assert.rejects(()=>photo(21,`${id(1)}/${fish}/../x.webp`),e=>e.code==='22023');
const photoAudit=(await query("select actor_role,context from app.audit_logs where action='PRODUCT_PHOTO_SAVED' order by created_at")).rows;
assert.deepEqual(photoAudit.map(a=>[a.actor_role,a.context.from,a.context.to]),[['OWNER',null,path()],['ADMIN',path(),path(id(1),fish,'c')]]);
console.log('PASS product photo: ADMIN/OWNER upload check and save, own business and product only, single primary, audited');
// 2. Offers: archive (delete), restore, stop now. No hard deletes.
const ver=o=>value('select version as value from app.offers where id=$1',[o]);
const change=(actor,o,op,version)=>as(actor,'select api.change_offer_state($1,$2,$3,$4) as value',[o,id(10),version,op]);
const offer=await save({code:'GONE10'});
const current=()=>as(null,'select api.store_offers($1) as value',[id(10)],'anon');
assert.equal((await current()).length,1);
for(const actor of [22,23])await assert.rejects(async()=>change(actor,offer,'ARCHIVE',await ver(offer)),deny);
await assert.rejects(()=>change(21,offer,'ARCHIVE',99),e=>e.code==='40001');
await change(21,offer,'ARCHIVE',await ver(offer));
let row=(await query('select is_active,archived_at from app.offers where id=$1',[offer])).rows[0];
assert.equal(row.is_active,false);assert.ok(row.archived_at);
assert.equal((await current()).length,0); // stops immediately on the site
const workspace=await as(21,'select api.offer_workspace($1) as value',[id(10)]);
assert.ok(workspace.offers.find(o=>o.id===offer).archived_at); // the admin list hides it unless "Show deleted"
assert.equal((await as(22,'select api.offer_workspace($1) as value',[id(10)])).current.length,0);
await assert.rejects(()=>save({code:'GONE10'}),e=>e.code==='23505'); // code stays reserved
await assert.rejects(async()=>save({id:offer,version:await ver(offer),code:'GONE10',active:true}),e=>e.code==='40001'); // archived is read-only
await assert.rejects(()=>query('update app.offers set is_active=true where id=$1',[offer]),e=>e.code==='23514');
await assert.rejects(async()=>change(21,offer,'ARCHIVE',await ver(offer)),e=>e.code==='40001');
await assert.rejects(async()=>change(21,offer,'STOP',await ver(offer)),e=>e.code==='40001');
await assert.rejects(async()=>change(22,offer,'RESTORE',await ver(offer)),deny);
await change(20,offer,'RESTORE',await ver(offer));
row=(await query('select is_active,archived_at from app.offers where id=$1',[offer])).rows[0];
assert.deepEqual([row.is_active,row.archived_at],[false,null]);assert.equal((await current()).length,0); // back in the list, inactive
await save({id:offer,version:await ver(offer),code:'GONE10',active:true});assert.equal((await current()).length,1);
// Stop now: a running offer and one that has not started.
await assert.rejects(async()=>change(22,offer,'STOP',await ver(offer)),deny);
await change(21,offer,'STOP',await ver(offer));
assert.equal((await current()).length,0);
assert.ok(new Date(await value('select ends_at as value from app.offers where id=$1',[offer]))<=new Date());
await assert.rejects(async()=>change(21,offer,'STOP',await ver(offer)),e=>e.code==='22023');
const future=await save({code:'LATER1',start:end,end:new Date(Date.now()+172800000).toISOString()});
await change(21,future,'STOP',await ver(future));
const f=(await query('select starts_at<ends_at as ok,ends_at<=now() as ended from app.offers where id=$1',[future])).rows[0];assert.deepEqual([f.ok,f.ended],[true,true]);
await assert.rejects(async()=>change(21,offer,'DELETE',await ver(offer)),e=>e.code==='22023');
assert.deepEqual([await audits('OFFER_ARCHIVED'),await audits('OFFER_RESTORED'),await audits('OFFER_STOPPED')],[1,1,2]);
const archivedAudit=(await query("select actor_role,store_id,context from app.audit_logs where action='OFFER_ARCHIVED'")).rows[0];
assert.deepEqual([archivedAudit.actor_role,archivedAudit.store_id,archivedAudit.context.code,archivedAudit.context.wasActive],['OWNER',id(10),'GONE10',true]);
assert.equal(await value("select count(*)::int as value from app.offers"),2); // nothing deleted
for(const role of ['anon','authenticated','service_role'])assert.equal(await value("select has_table_privilege($1,'app.offers','DELETE') as value",[role]),false);
for(const fn of ['api.change_offer_state(uuid,uuid,integer,text)','api.save_product_content(uuid,text,text)','api.set_product_photo(uuid,text,text)','api.product_content()'])
 for(const [role,ok] of [['anon',false],['authenticated',true]])assert.equal(await value("select has_function_privilege($1,$2,'EXECUTE') as value",[role,fn]),ok);
console.log('PASS offers: archive stops now and keeps the code, restore returns inactive, stop now ends running and future offers; ADMIN/OWNER only, audited, no deletes');
await db.close();
