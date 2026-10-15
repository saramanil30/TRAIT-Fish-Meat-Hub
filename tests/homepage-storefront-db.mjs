// Homepage redesign: social links, Today's Specials, category photos and the new homepage text keys, as ADMIN, OWNER, EMPLOYEE and anon.
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
const category=await as(20,"select api.save_category(null,'Sea Fish',null,0,true) as value");
const otherCategory=await as(23,"select api.save_category(null,'Other',null,0,true) as value");
const product=name=>as(20,`select api.save_product(null,$1,$2,'','','','[500,1000]','[{"name":"Whole"}]',true) as value`,[category,name]);
const [salmon,hilsa,retired]=[await product('Salmon'),await product('Hilsa'),await product('Retired')];
await query('update app.products set is_active=false where id=$1',[retired]);
const otherProduct=await as(23,`select api.save_product(null,$1,'Theirs','','','','[500]','[{"name":"Whole"}]',true) as value`,[otherCategory]);
const published=()=>as(null,'select api.homepage_content($1) as value',[id(10)],'anon');
const settings=actor=>as(actor,'select api.homepage_content_settings($1) as value',[id(10)]);

// Homepage text: the new keys are accepted with their limits; existing keys unchanged.
assert.equal(await as(21,'select api.save_homepage_text($1,0,$2) as value',[id(10),JSON.stringify({trust1:'Freshly Sourced',bannerTitle:'Freshness. Quality. Trust.'})]),1);
await assert.rejects(()=>as(21,'select api.save_homepage_text($1,1,$2) as value',[id(10),JSON.stringify({trust2:'x'.repeat(31)})]),e=>e.code==='22023');
console.log('PASS homepage text accepts trust labels and banner title within limits');

assert.deepEqual(await published(),{specials:[],categoryPhotos:{}});
const s0=await settings(21);
assert.equal(s0.linksVersion,0);assert.equal(s0.specialsVersion,0);assert.deepEqual(s0.categories.map(c=>c.name),['Sea Fish']);

// Social links.
const links=(actor,version,ig,fb)=>as(actor,'select api.save_homepage_links($1,$2,$3,$4) as value',[id(10),version,ig,fb]);
assert.equal(await links(21,0,'https://www.instagram.com/traitfish',null),1); // OWNER
assert.deepEqual((await published()).instagram,'https://www.instagram.com/traitfish');
assert.equal((await published()).facebook,undefined);
assert.equal(await links(20,1,'https://instagram.com/traitfish/','https://www.facebook.com/traitfish'),2); // ADMIN
await assert.rejects(()=>links(21,1,null,null),e=>e.code==='40001');
for(const [ig,fb] of [['http://instagram.com/x',null],['https://evil.com/instagram.com',null],['https://instagram.com.evil.com/x',null],['javascript:alert(1)',null],
 ['https://instagram.com/a b',null],['https://user@instagram.com/x',null],[null,'https://instagram.com/x'],[null,'https://facebook.com/"x'],['https://instagram.com/<x>',null]])
 await assert.rejects(()=>links(21,2,ig,fb),e=>e.code==='22023');
assert.equal(await links(21,2,null,null),3);
assert.deepEqual(Object.keys(await published()).sort(),['categoryPhotos','specials']);
console.log('PASS social links: https on own domain only, cleared links disappear, stale versions rejected');

// Specials.
const specials=(actor,version,list)=>as(actor,'select api.save_homepage_specials($1,$2,$3) as value',[id(10),version,JSON.stringify(list)]);
assert.equal(await specials(21,0,[{product:hilsa,badge:'LIMITED_STOCK',wasPaise:240000},{product:salmon,badge:null}]),1);
assert.deepEqual((await published()).specials,[{productId:hilsa,badge:'LIMITED_STOCK',wasPaise:240000},{productId:salmon}]);
assert.equal(await specials(20,1,[{product:salmon,badge:'TODAY_SPECIAL'}]),2);
assert.deepEqual((await published()).specials,[{productId:salmon,badge:'TODAY_SPECIAL'}]);
await assert.rejects(()=>specials(21,1,[]),e=>e.code==='40001');
for(const bad of [{},[{product:salmon},{product:salmon}],[{product:retired}],[{product:otherProduct}],[{product:salmon,badge:'HOT'}],[{product:salmon,wasPaise:0}],
 [{product:salmon,wasPaise:1.5}],[{product:salmon,wasPaise:'100'}],[{product:salmon,extra:1}],[{product:'not-a-uuid'}],['x'],Array.from({length:13},()=>({product:salmon}))])
 await assert.rejects(()=>specials(21,2,bad),e=>e.code==='22023');
// A product retired later drops off the storefront list on its own.
assert.equal(await specials(21,2,[{product:salmon},{product:hilsa}]),3);
await query('update app.products set is_active=false where id=$1',[hilsa]);
assert.deepEqual((await published()).specials,[{productId:salmon}]);
console.log('PASS specials: own active products, badge and was-price rules, order kept, retired products hidden');

// Category photos.
const hash='c'.repeat(64),path=id(1)+'/'+category+'/'+hash+'.webp';
const photo=(actor,cat,version,p)=>as(actor,'select api.save_category_photo($1,$2,$3) as value',[cat,version,p]);
assert.equal(await photo(21,category,0,path),1);
assert.deepEqual((await published()).categoryPhotos,{[category]:path});
assert.equal((await settings(20)).categories[0].photo,path);
await assert.rejects(()=>photo(21,category,0,path),e=>e.code==='40001');
for(const bad of [id(2)+'/'+category+'/'+hash+'.webp',id(1)+'/'+otherCategory+'/'+hash+'.webp',id(1)+'/'+category+'/'+hash+'.jpg',id(1)+'/'+category+'/../x.webp'])
 await assert.rejects(()=>photo(21,category,1,bad),e=>e.code==='22023');
await assert.rejects(()=>photo(21,otherCategory,0,null),e=>e.code==='42501');
assert.equal(await photo(20,category,1,null),2);
assert.deepEqual((await published()).categoryPhotos,{});
const can=(actor,name)=>as(actor,'select api.can_upload_category_image($1) as value',[name]);
assert.equal(await can(20,path),true);assert.equal(await can(21,path),true);
assert.equal(await can(22,path),false);assert.equal(await can(23,path),false);assert.equal(await can(21,path.replace('.webp','.png')),false);
assert.equal(await can(21,id(1)+'/'+otherCategory+'/'+hash+'.webp'),false);
console.log('PASS category photos: own business path, uploaded-object check, clear, upload policy check');

// EMPLOYEE, other businesses and anon are denied every write and the settings read.
for(const actor of [22,23]){
 await assert.rejects(()=>settings(actor),e=>e.code==='42501');
 await assert.rejects(()=>links(actor,3,null,null),e=>e.code==='42501');
 await assert.rejects(()=>specials(actor,3,[]),e=>e.code==='42501');
}
await assert.rejects(()=>photo(22,category,2,null),e=>e.code==='42501');
for(const sql of ['select api.homepage_content_settings($1) as value','select api.save_homepage_links($1,3,null,null) as value'])
 await assert.rejects(()=>as(null,sql,[id(10)],'anon'),/permission denied/);
await assert.rejects(()=>as(null,'select api.save_category_photo($1,2,null) as value',[category],'anon'),/permission denied/);
await assert.rejects(()=>as(null,'select api.can_upload_category_image($1) as value',[path],'anon'),/permission denied/);
for(const table of ['app.store_homepage_content','app.store_homepage_specials','app.category_photos']){
 for(const role of ['anon','authenticated','service_role','trait_checkout'])assert.equal(await value("select has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE') as value",[role,table]),false);
 assert.equal(await value('select relrowsecurity and relforcerowsecurity as value from pg_class where oid=$1::regclass',[table]),true);
}
const actions=(await query("select action,count(*)::int n from app.audit_logs where action in ('HOMEPAGE_LINKS_SAVED','HOMEPAGE_SPECIALS_SAVED','CATEGORY_PHOTO_SAVED') group by action order by action")).rows;
assert.deepEqual(actions.map(a=>[a.action,a.n]),[['CATEGORY_PHOTO_SAVED',2],['HOMEPAGE_LINKS_SAVED',3],['HOMEPAGE_SPECIALS_SAVED',3]]);
await query('update app.stores set is_active=false where id=$1',[id(10)]);
assert.equal(await published(),null);
console.log('PASS EMPLOYEE/other business/anon denied, tables closed with forced RLS, every save audited, inactive store publishes nothing');
await db.close();
