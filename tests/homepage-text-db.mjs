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
for(const [n,b,role] of [[20,1,'OWNER'],[21,1,'OWNER'],[22,1,'EMPLOYEE'],[23,2,'OWNER']]){await query('insert into auth.users values($1)',[id(n)]);await query("insert into app.staff_profiles(id,business_id,auth_user_id,display_name,role) values($1,$2,$1,'Test',$3)",[id(n),id(b),role]);}
await query('insert into app.staff_admin_grants(staff_profile_id) values($1),($2)',[id(20),id(23)]);
await query('insert into app.staff_store_assignments(business_id,store_id,staff_profile_id) values($1,$2,$3)',[id(1),id(10),id(22)]);
const save=(actor,version,content)=>as(actor,'select api.save_homepage_text($1,$2,$3) as value',[id(10),version,JSON.stringify(content)]);
const settings=actor=>as(actor,'select api.homepage_text_settings($1) as value',[id(10)]);
const published=()=>as(null,'select api.homepage_text($1) as value',[id(10)],'anon');

assert.deepEqual(await published(),{});
assert.deepEqual(await settings(21),{content:{},version:0});
assert.equal(await save(21,0,{badge:'Welcome',headline:'Fresh today',highlight:'Cut your way.'}),1); // OWNER
assert.deepEqual(await published(),{badge:'Welcome',headline:'Fresh today',highlight:'Cut your way.'});
assert.equal(await save(20,1,{subtitle:'Only the subtitle'}),2); // ADMIN; omitted fields fall back
assert.deepEqual(await published(),{subtitle:'Only the subtitle'});
await assert.rejects(()=>save(21,1,{badge:'Stale'}),e=>e.code==='40001');
await assert.rejects(()=>save(21,0,{badge:'Stale'}),e=>e.code==='40001');
console.log('PASS ADMIN/OWNER save, empty fields fall back, stale versions rejected');

for(const bad of [{badge:'<b>x</b>'},{badge:'a\nb'},{badge:' padded'},{badge:''},{badge:'x'.repeat(41)},{unknown:'x'},{badge:1},[]])
 await assert.rejects(()=>save(21,2,bad),e=>e.code==='22023');
assert.equal(await save(21,2,{badge:'x'.repeat(40),subtitle:'Fish & meat — "fresh" daily'}),3);
for(const actor of [22,23]){
 await assert.rejects(()=>save(actor,3,{badge:'Nope'}),e=>e.code==='42501');
 await assert.rejects(()=>settings(actor),e=>e.code==='42501');
}
await assert.rejects(()=>as(null,'select api.save_homepage_text($1,$2,$3) as value',[id(10),3,'{}'],'anon'),/permission denied/);
await assert.rejects(()=>as(null,'select api.homepage_text_settings($1) as value',[id(10)],'anon'),/permission denied/);
console.log('PASS plain text and length limits, EMPLOYEE and other businesses denied');

const audit=(await query("select actor_id,context from app.audit_logs where action='HOMEPAGE_TEXT_SAVED' order by created_at")).rows;
assert.equal(audit.length,3);assert.equal(audit[0].actor_id,id(21));assert.deepEqual(audit[0].context.fields,['badge','headline','highlight']);
for(const role of ['anon','authenticated','service_role','trait_checkout'])assert.equal(await value("select has_table_privilege($1,'app.store_homepage_text','SELECT,INSERT,UPDATE,DELETE') as value",[role]),false);
assert.equal(await value("select relrowsecurity and relforcerowsecurity as value from pg_class where oid='app.store_homepage_text'::regclass"),true);
await query('update app.stores set is_active=false where id=$1',[id(10)]);
assert.deepEqual(await published(),{});
console.log('PASS audited saves, table closed with forced RLS, inactive store publishes nothing');
await db.close();
