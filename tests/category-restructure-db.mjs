process.on('uncaughtException',e=>{console.error(e.message,e.code??'',e.where??'');process.exit(1);});
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '../node_modules/.staff-validation/node_modules/@electric-sql/pglite/dist/index.js';
const db=new PGlite();
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const value=async(s,a=[])=>(await db.query(s,a)).rows[0].value;
async function as(n,sql,args=[]){await db.exec('SET ROLE authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id(n)]);try{return await value(sql,args);}finally{await db.exec('RESET ROLE');}}
await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY); CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;");
const files=readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort();
const target='20261010010000_category_restructure.sql';
for(const f of files.filter(f=>f<target))await db.exec(readFileSync('supabase/migrations/'+f,'utf8'));
await db.query("insert into app.businesses(id,slug,display_name) values($1,'test','Test')",[id(1)]);
await db.query('insert into auth.users values($1)',[id(20)]);
await db.query("insert into app.staff_profiles(id,business_id,auth_user_id,display_name,role) values($1,$2,$1,'Test','OWNER')",[id(20),id(1)]);
await db.query('insert into app.staff_admin_grants(staff_profile_id) values($1)',[id(20)]);
// Live shape: FRESH WATER, SEAFOOD, EGGS, Chicken, Mutton with their products.
const cats={};
for(const [name,sort] of [['Chicken',0],['EGGS',0],['Mutton',0],['SEAFOOD',1],['FRESH WATER',2]])cats[name]=await as(20,'select api.save_category(null,$1,null,$2,true) as value',[name,sort]);
for(const [cat,name] of [['SEAFOOD','Sea Prawns Big'],['SEAFOOD','Blue Crab'],['SEAFOOD','King Fish / Vanjaram'],['FRESH WATER','Prawns Above Medium'],['FRESH WATER','Rohu Big'],['Chicken','Chicken Curry Cuts']])
 await as(20,`select api.save_product(null,$1,$2,'','','','[500,1000]','[{"name":"Whole"}]',true) as value`,[cats[cat],name]);
await db.exec(readFileSync('supabase/migrations/'+target,'utf8'));
const rows=(await db.query("select c.id,c.name,c.sort_order,c.parent_id,c.is_active,coalesce(string_agg(p.name,', ' order by p.name),'') products from app.categories c left join app.products p on p.category_id=c.id where c.business_id=$1 group by c.id order by c.sort_order",[id(1)])).rows;
assert.deepEqual(rows.map(r=>[r.sort_order,r.name,r.products]),[
 [1,'River Fish','Rohu Big'],[2,'Sea Fish','King Fish / Vanjaram'],[3,'Prawns','Prawns Above Medium, Sea Prawns Big'],[4,'Crabs & Lobsters','Blue Crab'],
 [5,'Chicken','Chicken Curry Cuts'],[6,'Mutton',''],[7,'Eggs',''],[8,'Dry Fish','']]);
assert.equal(rows.find(r=>r.name==='River Fish').id,cats['FRESH WATER']);assert.equal(rows.find(r=>r.name==='Sea Fish').id,cats.SEAFOOD);
assert.ok(rows.every(r=>r.parent_id===null&&r.is_active));
// Re-running changes nothing.
await db.exec(readFileSync('supabase/migrations/'+target,'utf8'));
assert.equal(await value('select count(*)::int as value from app.categories where business_id=$1',[id(1)]),8);
// The approved catalogue import (same names as the live store) lands the same way.
const imported=(await db.query("select c.name,c.sort_order,string_agg(p.name,', ' order by p.name) products from app.categories c left join app.products p on p.category_id=c.id where c.business_id<>$1 group by c.id order by c.sort_order",[id(1)])).rows;
assert.deepEqual(imported.slice(0,4).map(r=>[r.sort_order,r.name]),[[1,'River Fish'],[2,'Sea Fish'],[3,'Prawns'],[4,'Crabs & Lobsters']]);
assert.equal(imported.find(r=>r.name==='Prawns').products,'Prawns Above Medium, Sea Prawns Big');
assert.equal(imported.find(r=>r.name==='Crabs & Lobsters').products,'Blue Crab');
// Empty categories are still published to the storefront (they show the call-us notice).
for(const f of files.filter(f=>f>target))await db.exec(readFileSync('supabase/migrations/'+f,'utf8'));
console.log('PASS renames keep IDs, new categories, product moves, order 1-8, all top-level, idempotent');
