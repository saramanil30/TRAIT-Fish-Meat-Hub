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
await query("insert into app.stores(id,business_id,code,name,address_line1,city,state,pickup_enabled) values($1,$2,'test','Test','Test street','Test city','Test state',true),($3,$4,'other','Other','Other street','Other city','Other state',true)",[id(10),id(1),id(11),id(2)]);
for(const [n,b,role] of [[20,1,'OWNER'],[21,1,'OWNER'],[22,1,'EMPLOYEE'],[23,2,'OWNER']]){await query('insert into auth.users values($1)',[id(n)]);await query("insert into app.staff_profiles(id,business_id,auth_user_id,display_name,role) values($1,$2,$1,'Test',$3)",[id(n),id(b),role]);}
await query('insert into app.staff_admin_grants(staff_profile_id) values($1),($2)',[id(20),id(23)]);
await query('insert into app.staff_store_assignments(business_id,store_id,staff_profile_id) values($1,$2,$3)',[id(1),id(10),id(22)]);
const file=(c,ext='png',b=1,s=10)=>id(b)+'/'+id(s)+'/'+c.repeat(64)+'.'+ext;
const save=(actor,version,d,w,h,m,size,fav,touch,store=id(10))=>as(actor,'select api.save_store_branding($1,$2,$3,$4,$5,$6,$7,$8,$9) as value',[store,version,d,w,h,m,size,fav,touch]);
const published=()=>as(null,'select api.store_branding($1) as value',[id(10)],'anon');
const settings=actor=>as(actor,'select api.store_branding_settings($1) as value',[id(10)]);

assert.deepEqual(await published(),{});
assert.deepEqual(await settings(21),{version:0});
assert.equal(await save(21,0,file('a','webp'),800,200,null,null,null,null),1); // OWNER: desktop only
assert.deepEqual(await published(),{desktopLogo:{path:file('a','webp'),width:800,height:200},version:1});
assert.equal(await save(20,1,file('a','webp'),800,200,file('b'),512,file('c'),file('d')),2); // ADMIN adds the mobile logo
assert.deepEqual(await published(),{desktopLogo:{path:file('a','webp'),width:800,height:200},mobileLogo:file('b'),favicon:file('c'),touchIcon:file('d'),version:2});
await assert.rejects(()=>save(21,1,null,null,null,null,null,null,null),e=>e.code==='40001');
await assert.rejects(()=>save(21,0,null,null,null,null,null,null,null),e=>e.code==='40001');
console.log('PASS ADMIN/OWNER save, desktop and mobile independent, stale versions rejected');

for(const bad of [
 [file('e','webp'),299,200,null,null,null,null], // not wide enough
 [file('e'),800,39,null,null,null,null],[file('e'),2401,600,null,null,null,null],[file('e'),800,null,null,null,null,null],
 [null,800,200,null,null,null,null],[file('e','jpg'),800,200,null,null,null,null],
 [file('e','png',2,10),800,200,null,null,null,null], // another business
 [file('e','png',1,11),800,200,null,null,null,null], // a store outside the path rules
 [null,null,null,file('b'),191,file('c'),file('d')],[null,null,null,file('b'),512,null,file('d')],[null,null,null,file('b'),512,file('c','webp'),file('d')],
 [null,null,null,null,null,file('c'),null]])
 await assert.rejects(()=>save(21,2,...bad),e=>e.code==='22023');
for(const actor of [22,23]){
 await assert.rejects(()=>save(actor,2,null,null,null,null,null,null,null),e=>e.code==='42501');
 await assert.rejects(()=>settings(actor),e=>e.code==='42501');
}
await assert.rejects(()=>as(null,'select api.save_store_branding($1,$2,$3,$4,$5,$6,$7,$8,$9) as value',[id(10),2,null,null,null,null,null,null,null],'anon'),/permission denied/);
await assert.rejects(()=>as(null,'select api.store_branding_settings($1) as value',[id(10)],'anon'),/permission denied/);
await assert.rejects(()=>as(21,'select app.valid_brand_object($1,$2,$3,false,10) as value',[id(1),id(10),file('a')]),/permission denied/);
console.log('PASS sizes, types, paths and favicon set checked; EMPLOYEE, other businesses and anon denied');

const can=(actor,name)=>as(actor,'select api.can_upload_brand_image($1) as value',[name]);
assert.equal(await can(20,file('f')),true);assert.equal(await can(21,file('f','webp')),true);
assert.equal(await can(22,file('f')),false);assert.equal(await can(23,file('f')),false);assert.equal(await can(21,file('f','svg')),false);
assert.equal(await can(21,file('f','png',1,11)),false);assert.equal(await can(23,file('f','png',2,11)),true);
console.log('PASS upload check: ADMIN/OWNER, own business and store, PNG/WebP only');

assert.equal(await save(21,2,null,null,null,file('b'),512,file('c'),file('d')),3); // remove desktop logo
assert.deepEqual(await published(),{mobileLogo:file('b'),favicon:file('c'),touchIcon:file('d'),version:3});
assert.equal(await save(21,3,null,null,null,null,null,null,null),4);
assert.deepEqual(await published(),{version:4});
const audit=(await query("select actor_id,context from app.audit_logs where action='STORE_BRANDING_SAVED' order by created_at")).rows;
assert.equal(audit.length,4);assert.equal(audit[0].actor_id,id(21));assert.equal(audit[1].context.favicon,file('c'));
for(const role of ['anon','authenticated','service_role','trait_checkout'])assert.equal(await value("select has_table_privilege($1,'app.store_branding','SELECT,INSERT,UPDATE,DELETE') as value",[role]),false);
assert.equal(await value("select relrowsecurity and relforcerowsecurity as value from pg_class where oid='app.store_branding'::regclass"),true);
await query('update app.stores set is_active=false where id=$1',[id(10)]);
assert.deepEqual(await published(),{});
console.log('PASS removal falls back, audited saves, table closed with forced RLS, inactive store publishes nothing');
await db.close();
