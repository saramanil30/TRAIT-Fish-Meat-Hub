// api.set_product_photo ("change photo") replaces the main photo instead of adding one, as ADMIN, OWNER, EMPLOYEE and other businesses.
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
for(const [n,b,role] of [[20,1,'OWNER'],[21,1,'OWNER'],[22,1,'EMPLOYEE'],[23,2,'OWNER']]){await query('insert into auth.users values($1)',[id(n)]);await query("insert into app.staff_profiles(id,business_id,auth_user_id,display_name,role) values($1,$2,$1,'Test',$3)",[id(n),id(b),role]);}
await query('insert into app.staff_admin_grants(staff_profile_id) values($1),($2)',[id(20),id(23)]);
const category=await as(20,"select api.save_category(null,'Fish',null,0,true) as value");
const product=await as(20,`select api.save_product(null,$1,'Salmon','','','','[500,1000]','[{"name":"Whole"}]',true) as value`,[category]);
const path=n=>id(1)+'/'+product+'/'+String(n).repeat(64)+'.webp';
const add=(actor,n)=>as(actor,'select api.add_product_photo($1,$2,$3) as value',[product,path(n),'Salmon']);
const replace=(actor,p)=>as(actor,'select api.set_product_photo($1,$2,$3) as value',[product,p,'Salmon']);
const gallery=async()=>(await query('select storage_object_path p,is_primary m from app.product_images where product_id=$1 and is_active order by is_primary desc,sort_order,created_at,id',[product])).rows.map(r=>(r.m?'*':'')+r.p.slice(-6,-5));

// No main photo yet: the new photo becomes main.
await replace(21,path(1));
assert.deepEqual(await gallery(),['*1']);
await add(21,2);await add(21,3);
assert.deepEqual(await gallery(),['*1','2','3']);
// Replacing the main photo swaps it in place; the old main is soft-removed, not deleted.
await replace(21,path(4)); // OWNER
assert.deepEqual(await gallery(),['*4','2','3']);
assert.equal(await value('select count(*)::int as value from app.product_images where product_id=$1 and storage_object_path=$2 and not is_active',[product,path(1)]),1);
// Works at the 5-photo limit, where adding fails.
await add(20,5);await add(20,6);
await assert.rejects(()=>add(20,7),e=>e.code==='22023');
await replace(20,path(7)); // ADMIN
assert.deepEqual(await gallery(),['*7','2','3','5','6']);
// The same picture again changes nothing; a picture already in the gallery is refused.
const before=await gallery();await replace(21,path(7));assert.deepEqual(await gallery(),before);
await assert.rejects(()=>replace(21,path(2)),e=>e.code==='22023'&&/already in the gallery/.test(e.message));
// Exactly one active main photo throughout.
assert.equal(await value('select count(*)::int as value from app.product_images where product_id=$1 and is_active and is_primary',[product]),1);
// After every photo is removed, replace puts the new photo first and keeps the others' order.
for(const p of (await query('select id from app.product_images where product_id=$1 and is_active and is_primary',[product])).rows)
 await as(21,'select api.remove_product_photo($1,$2) as value',[product,p.id]);
assert.deepEqual(await gallery(),['*2','3','5','6']);
await query('update app.product_images set is_primary=false where product_id=$1',[product]);
await replace(21,path(8));
assert.deepEqual(await gallery(),['*8','2','3','5','6']);
console.log('PASS set_product_photo replaces the main photo in place, soft-removes the old one, works at 5 photos, no duplicates');

for(const actor of [22,23])await assert.rejects(()=>replace(actor,path(9)),e=>e.code==='42501');
await assert.rejects(()=>as(null,'select api.set_product_photo($1,$2,$3) as value',[product,path(9),''],'anon'),/permission denied/);
for(const bad of [id(2)+'/'+product+'/'+'9'.repeat(64)+'.webp',id(1)+'/'+product+'/'+'9'.repeat(64)+'.jpg',null])await assert.rejects(()=>replace(21,bad),e=>e.code==='22023');
assert.equal(await value("select count(*)::int as value from app.audit_logs where action='PRODUCT_PHOTO_SAVED'"),4);
console.log('PASS EMPLOYEE, other businesses and anon denied; own-business WebP paths only; every replacement audited');
await db.close();
