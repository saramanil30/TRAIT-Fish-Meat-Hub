import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
// Isolated, in-memory PostgreSQL. No network connection or real credentials.
const {PGlite}=await import("../../node_modules/.staff-validation/node_modules/@electric-sql/pglite/dist/index.js");
const db=new PGlite();
const foundation=readFileSync(new URL("../migrations/20260923041240_phase_5b_1_foundation.sql",import.meta.url),"utf8");
const migration=readFileSync(new URL("../migrations/20260926000000_staff_access.sql",import.meta.url),"utf8");
assert.equal(createHash("sha256").update(foundation).digest("hex"),"93de04ce74fcb365cdb978251530c4720e4c6a3dc702217e7c13bb07b134316f","Applied foundation must remain unchanged");
let checks=0;
const check=(name,fn)=>fn().then(()=>{checks++;console.log("PASS "+name);});
await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY); CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;");
await db.exec(foundation);
await db.exec(migration);
const catalogue=readFileSync(new URL("../migrations/20260926120000_phase_5b_2_catalogue.sql",import.meta.url),"utf8");
assert.equal(createHash("sha256").update(migration).digest("hex"),"848f55a0176d1736ab0de446fda188f74b9c8fdbba71011e7e529463d59344a0");
await db.exec(catalogue);
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const scalar=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
await db.query("INSERT INTO app.businesses(id,slug,display_name) VALUES ($1,'test','Test'),($2,'other','Other')",[id(1),id(2)]);
await db.query("INSERT INTO app.stores(id,business_id,code,name,address_line1,city,state) VALUES ($1,$2,'main','Main','Test','Test','Test'),($3,$2,'branch','Branch','Test','Test','Test'),($4,$5,'other','Other','Test','Test','Test')",[id(10),id(1),id(11),id(12),id(2)]);
for(const [n,role,business] of [[20,"OWNER",1],[21,"OWNER",1],[22,"EMPLOYEE",1],[23,"OWNER",2],[24,"EMPLOYEE",1]]) {
 await db.query("INSERT INTO auth.users VALUES ($1)",[id(n)]);
 await db.query("INSERT INTO app.staff_profiles(id,business_id,auth_user_id,display_name,role) VALUES ($1,$2,$1,$3,$4)",[id(n),id(business),role+n,role]);
}
await db.query("INSERT INTO app.staff_admin_grants(staff_profile_id) VALUES ($1)",[id(20)]);
await db.query("INSERT INTO app.staff_store_assignments(business_id,store_id,staff_profile_id) VALUES ($1,$2,$3)",[id(1),id(10),id(22)]);
async function as(n,fn,role="authenticated") {
 await db.exec("SET ROLE "+role);
 await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[n?id(n):""]);
 try{return await fn();}finally{await db.exec("RESET ROLE");}
}
async function denied(n,sql,args=[],role="authenticated") {
 await assert.rejects(()=>as(n,()=>db.query(sql,args),role));
}
let category,product,offering;
await check("migration executes after unmodified foundation",async()=>assert.ok(true));
await check("effective ADMIN, OWNER, EMPLOYEE roles and store scopes",async()=>{
 for(const [n,role,stores] of [[20,"ADMIN",2],[21,"OWNER",2],[22,"EMPLOYEE",1]]) {
 const r=await as(n,()=>scalar("SELECT api.staff_context() AS value"));
 assert.equal(r.value.role,role);assert.equal(r.value.stores.length,stores);
 }
});
await check("nonstaff and anonymous callers denied",async()=>{
 await denied(99,"SELECT api.staff_context()");await denied(null,"SELECT api.staff_context()",[],"anon");
});
await check("ADMIN creates category, complete product master and offering",async()=>{
 category=(await as(20,()=>scalar("SELECT api.save_category(NULL,'Fish',NULL,1,true) AS id"))).id;
 product=(await as(20,()=>scalar("SELECT api.save_product(NULL,$1,'Fish','Local','Description','/assets/fish.jpg','[500,1000]','[{\"name\":\"Cleaned\",\"cleaning_loss_percent\":25}]',true) AS id",[category]))).id;
 offering=(await as(20,()=>scalar("SELECT api.create_offering($1,$2) AS id",[product,id(10)]))).id;
});
await check("OWNER and EMPLOYEE cannot call catalogue master RPCs directly",async()=>{
 for(const n of [21,22,23]) {
 await denied(n,"SELECT api.save_category(NULL,'Forged',NULL,0,true)");
 await denied(n,"SELECT api.save_category($1,'Renamed',NULL,0,false)",[category]);
 await denied(n,"SELECT api.save_product($1,$2,'Forged','','','','[1000]','[{\"name\":\"Whole\"}]',false)",[product,category]);
 await denied(n,"SELECT api.create_offering($1,$2)",[product,id(11)]);
 await denied(n,"SELECT api.catalogue_master()");
 }
});
await check("no direct DML, elevation, history or private helper access for any JWT role",async()=>{
 for(const n of [20,21,22]) {
 await denied(n,"UPDATE app.products SET name='Forged'");
 await denied(n,"DELETE FROM app.categories");
 await denied(n,"INSERT INTO app.staff_admin_grants(staff_profile_id) VALUES ($1)",[id(21)]);
 await denied(n,"UPDATE app.staff_profiles SET role='OWNER'");
 await denied(n,"UPDATE app.product_store_settings SET available=true");
 await denied(n,"DELETE FROM app.product_prices");
 await denied(n,"SELECT app.current_staff_role()");
 }
 await denied(null,"SELECT * FROM app.products",[],"service_role");
});
await check("OWNER price and availability update is atomic, versioned and audited",async()=>{
 await as(21,()=>db.query("SELECT api.update_daily_product($1,1,50000,true)",[offering]));
 assert.equal((await scalar("SELECT count(*)::int AS n FROM app.product_prices")).n,1);
 await as(21,()=>db.query("SELECT api.update_daily_product($1,2,60000,false)",[offering]));
 const prices=(await db.query("SELECT price_per_kg_paise::int AS price FROM app.product_prices ORDER BY offering_version")).rows;
 assert.deepEqual(prices.map(p=>p.price),[50000,60000]);
 assert.equal((await scalar("SELECT count(*)::int AS n FROM app.staff_access_audit WHERE action='DAILY_PRODUCT_UPDATED'")).n,2);
 assert.equal((await as(21,()=>scalar("SELECT api.daily_products($1) AS products",[id(10)]))).products[0].available,false);
});
await check("availability-only and no-op edits do not fabricate price history",async()=>{
 await as(21,()=>db.query("SELECT api.update_daily_product($1,3,60000,true)",[offering]));
 await as(21,()=>db.query("SELECT api.update_daily_product($1,4,60000,true)",[offering]));
 assert.equal((await scalar("SELECT count(*)::int AS n FROM app.product_prices")).n,2);
 assert.equal((await scalar("SELECT version FROM app.product_store_settings WHERE id=$1",[offering])).version,4);
});
await check("stale writes, invalid values, cross-business and EMPLOYEE daily operations denied",async()=>{
 await denied(21,"SELECT api.update_daily_product($1,1,70000,true)",[offering]);
 for(const n of [22,23,99]) {
 await denied(n,"SELECT api.update_daily_product($1,4,70000,true)",[offering]);
 await denied(n,"SELECT api.daily_products($1)",[id(10)]);
 }
 for(const price of [0,-1,100000001,null]) await denied(21,"SELECT api.update_daily_product($1,4,$2,true)",[offering,price]);
 await denied(21,"SELECT api.update_daily_product($1,4,70000,NULL)",[offering]);
 assert.equal((await scalar("SELECT version FROM app.product_store_settings WHERE id=$1",[offering])).version,4);
});
await check("strict master configuration and category cycles rejected",async()=>{
 await denied(20,"SELECT api.save_product($1,$2,'Fish','','','','[500,500]','[{\"name\":\"Whole\"}]',true)",[product,category]);
 await denied(20,"SELECT api.save_product($1,$2,'Fish','','','','[1000]','[{\"name\":\"Cleaned\",\"cleaning_loss_percent\":100}]',true)",[product,category]);
 const child=(await as(20,()=>scalar("SELECT api.save_category(NULL,'Child',$1,1,true) AS id",[category]))).id;
 await denied(20,"SELECT api.save_category($1,'Fish',$2,1,true)",[category,child]);
});
await check("ADMIN retains product edits and retirement; OWNER cannot update retired products",async()=>{
 await as(20,()=>db.query("SELECT api.save_product($1,$2,'Fish revised','Local','Description','/assets/new.jpg','[500]','[{\"name\":\"Whole\"}]',false)",[product,category]));
 await denied(21,"SELECT api.update_daily_product($1,4,70000,true)",[offering]);
});
await check("OWNER manages employees only; disabled membership loses authority",async()=>{
 await as(21,()=>db.query("SELECT api.set_employee_access($1,false)",[id(22)]));
 await denied(22,"SELECT api.staff_context()");
 await as(21,()=>db.query("SELECT api.set_employee_access($1,true)",[id(22)]));
 await as(22,()=>db.query("SELECT api.staff_context()"));
 for(const target of [20,21,23]) await denied(21,"SELECT api.set_employee_access($1,false)",[id(target)]);
 await denied(22,"SELECT api.set_employee_access($1,false)",[id(24)]);
});
await check("normal store operations scoped; EMPLOYEE denied",async()=>{
 await as(21,()=>db.query("SELECT api.save_store_operations($1,'Main updated',true,true,'{\"mon\":[{\"opens\":\"09:00\",\"closes\":\"18:00\"}]}')",[id(10)]));
 await denied(21,"SELECT api.save_store_operations($1,'Other',true,true,'{}')",[id(12)]);
 await denied(22,"SELECT api.store_operations($1)",[id(10)]);
});
await check("RLS enabled and forced on every private table, authenticated has no table ACLs",async()=>{
 const tables=(await db.query("SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') AS granted FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='app' AND c.relkind='r'")).rows;
 assert.equal(tables.length,15);for(const t of tables){assert.ok(t.relrowsecurity&&t.relforcerowsecurity);assert.equal(t.granted,false);}
});
await check("history immutable even through privileged ordinary DML; foundation last-owner guard retained",async()=>{
 await assert.rejects(()=>db.exec("UPDATE app.product_prices SET price_per_kg_paise=1"));
 await assert.rejects(()=>db.exec("DELETE FROM app.staff_access_audit"));
 await assert.rejects(()=>db.query("UPDATE app.staff_profiles SET is_active=false,disabled_at=now() WHERE id=$1",[id(21)]));
});
await check("business deactivation and ADMIN grant revocation take effect immediately",async()=>{
 await db.query("UPDATE app.businesses SET is_active=false WHERE id=$1",[id(1)]);
 await denied(20,"SELECT api.staff_context()"); await denied(21,"SELECT api.staff_context()");
 await db.query("UPDATE app.businesses SET is_active=true WHERE id=$1",[id(1)]);
 await db.query("UPDATE app.staff_admin_grants SET is_active=false WHERE staff_profile_id=$1",[id(20)]);
 await denied(20,"SELECT api.catalogue_master()");
 assert.equal((await as(20,()=>scalar("SELECT api.staff_context() AS value"))).value.role,"OWNER");
});
await check("no anonymous/service RPC execution or private helper grants",async()=>{
 const functions=(await db.query("SELECT n.nspname,p.proname,has_function_privilege('anon',p.oid,'EXECUTE') AS anon,has_function_privilege('service_role',p.oid,'EXECUTE') AS service,has_function_privilege('authenticated',p.oid,'EXECUTE') AS staff FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('app','api')")).rows;
 for(const f of functions){assert.equal(f.anon,f.nspname==="api"&&f.proname==="catalogue");assert.equal(f.service,false);assert.equal(f.staff,f.nspname==="api");}
});
console.log(checks+" database security groups passed. Foundation SHA256 "+createHash("sha256").update(foundation).digest("hex"));


await db.query("UPDATE app.staff_admin_grants SET is_active=true WHERE staff_profile_id=$1",[id(20)]);
await as(20,()=>db.query("SELECT api.save_product($1,$2,'Fish revised','Local','Description','/assets/new.jpg','[500,1000]','[{\"name\":\"Whole\"},{\"name\":\"Cleaned\",\"cleaning_loss_percent\":25.555}]',true)",[product,category]));
let prep, imageId;
await check("normalized choices preserve grams and per-preparation optional loss",async()=>{
 const rows=(await db.query("SELECT opt.name,pp.cleaning_loss_percent FROM app.product_preparation_options pp JOIN app.preparation_options opt ON opt.id=pp.preparation_option_id WHERE pp.product_id=$1 AND pp.is_active ORDER BY pp.sort_order",[product])).rows;
 assert.deepEqual(rows.map(r=>[r.name,r.cleaning_loss_percent]),[["Whole",null],["Cleaned","25.555"]]);
 assert.deepEqual((await db.query("SELECT raw_weight_grams FROM app.product_allowed_weights WHERE product_id=$1 AND is_active ORDER BY sort_order",[product])).rows.map(x=>x.raw_weight_grams),[500,1000]);
 prep=(await scalar("SELECT id FROM app.preparation_options WHERE name='Cleaned'")).id;
});
await check("public projection exposes raw-weight prices and Sold Out state, no staff fields",async()=>{
 await as(21,()=>db.query("SELECT api.update_daily_product($1,4,65000,false)",[offering]));
 const result=(await as(null,()=>scalar("SELECT api.catalogue($1) AS value",[id(10)]),"anon")).value;
 assert.equal(result.products.length,1);const p=result.products[0];
 assert.equal(p.available,false);assert.equal(p.pricePerKgPaise,65000);assert.equal(p.pricingBasis,"RAW_WEIGHT");
 assert.deepEqual(p.weightsGrams,[500,1000]);assert.equal(p.preparations.find(x=>x.name==="Whole").cleaningLossPercent,null);
 for(const key of ["business_id","created_by","auth_user_id","actor_id"])assert.equal(JSON.stringify(result).includes(key),false);
});
await check("all new master RPCs deny OWNER, EMPLOYEE, nonstaff, and other-business ADMIN",async()=>{
 await db.query("INSERT INTO app.staff_admin_grants(staff_profile_id) VALUES ($1)",[id(23)]);
 const calls=[
 ["SELECT api.save_preparation_option($1,'Forged',true,1)",[prep]],
 ["SELECT api.set_product_configuration($1,'[1000]','[{\"name\":\"Whole\"}]')",[product]],
 ["SELECT api.set_product_display($1,true,1)",[product]],
 ["SELECT api.set_offering_display($1,false,true,1)",[offering]],
 ["SELECT api.save_product_image(NULL,$1,'/assets/test.jpg',NULL,NULL,'Test',true,true,1)",[product]]
 ];
 for(const n of [21,22,23,99])for(const [sql,args] of calls)await denied(n,sql,args);
});
await check("ADMIN display overrides, offering retirement and daily OWNER boundary",async()=>{
 await as(20,()=>db.query("SELECT api.set_product_display($1,true,5)",[product]));
 await as(20,()=>db.query("SELECT api.set_offering_display($1,true,false,2)",[offering]));
 let p=(await as(null,()=>scalar("SELECT api.catalogue($1) AS value",[id(10)]),"anon")).value.products[0];
 assert.equal(p.featured,false);assert.equal(p.sortOrder,2);
 await as(20,()=>db.query("SELECT api.set_offering_display($1,false,NULL,NULL)",[offering]));
 assert.equal((await as(null,()=>scalar("SELECT api.catalogue($1) AS value",[id(10)]),"anon")).value.products.length,0);
 const version=(await scalar("SELECT version FROM app.product_store_settings WHERE id=$1",[offering])).version;
 await denied(21,"SELECT api.update_daily_product($1,$2,70000,true)",[offering,version]);
 await as(20,()=>db.query("SELECT api.set_offering_display($1,true,NULL,NULL)",[offering]));
});
await check("image metadata validates paths, tenant provenance and single primary; no Storage writes",async()=>{
 imageId=(await as(20,()=>scalar("SELECT api.save_product_image(NULL,$1,'/assets/fish-two.webp',NULL,NULL,'Fresh fish',true,true,1) AS id",[product]))).id;
 assert.equal((await scalar("SELECT count(*)::int AS n FROM app.product_images WHERE product_id=$1 AND is_primary AND is_active",[product])).n,1);
 for(const path of ["/assets/../secret.jpg","https://other.invalid/fish.jpg","/assets/file.svg"])
 await denied(20,"SELECT api.save_product_image(NULL,$1,$2,NULL,NULL,'bad',false,true,1)",[product,path]);
 await denied(20,"SELECT api.save_product_image(NULL,$1,NULL,NULL,$2,'missing bucket',false,true,1)",[product,id(1)+"/"+product+"/fish.jpg"]);
 await denied(20,"SELECT api.save_product_image(NULL,$1,NULL,'product-images',$2,'foreign',false,true,1)",[product,id(2)+"/"+product+"/fish.jpg"]);
 await as(20,()=>db.query("SELECT api.save_product_image(NULL,$1,NULL,'product-images',$2,'Reference only',false,true,2)",[product,id(1)+"/"+product+"/fish.jpg"]));
 const images=(await as(null,()=>scalar("SELECT api.catalogue($1) AS value",[id(10)]),"anon")).value.products[0].images;
 assert.equal(images[0].id,imageId);
});
await check("reusable preparation rename/retirement and product reconfiguration preserve IDs",async()=>{
 await as(20,()=>db.query("SELECT api.save_preparation_option($1,'Cleaned fish',true,1)",[prep]));
 let config=(await scalar("SELECT preparations FROM app.products WHERE id=$1",[product])).preparations;
 assert.equal(config[1].name,"Cleaned fish");
 assert.equal((await scalar("SELECT count(*)::int AS n FROM app.product_preparation_options WHERE product_id=$1 AND is_active",[product])).n,2);
 await as(20,()=>db.query("SELECT api.save_preparation_option($1,'Cleaned fish',false,1)",[prep]));
 let p=(await as(null,()=>scalar("SELECT api.catalogue($1) AS value",[id(10)]),"anon")).value.products[0];
 assert.deepEqual(p.preparations.map(x=>x.name),["Whole"]);
 const weightId=(await scalar("SELECT id FROM app.product_allowed_weights WHERE product_id=$1 AND raw_weight_grams=500",[product])).id;
 await as(20,()=>db.query("SELECT api.set_product_configuration($1,'[1000]','[{\"name\":\"Whole\"}]')",[product]));
 await as(20,()=>db.query("SELECT api.set_product_configuration($1,'[500,1000]','[{\"name\":\"Whole\"}]')",[product]));
 assert.equal((await scalar("SELECT id FROM app.product_allowed_weights WHERE product_id=$1 AND raw_weight_grams=500",[product])).id,weightId);
 for(const weights of ["[]","[0]","[500,500]","[1.5]"])await denied(20,"SELECT api.set_product_configuration($1,$2,'[{\"name\":\"Whole\"}]')",[product,weights]);
 await denied(20,"SELECT api.set_product_configuration($1,'[1000]','[{\"name\":\"Whole\",\"cleaning_loss_percent\":100}]')",[product]);
});
await check("subcategory filtering and inactive ancestors hide offerings from both public and OWNER",async()=>{
 const child=(await as(20,()=>scalar("SELECT api.save_category(NULL,'Sea fish',$1,1,true) AS id",[category]))).id;
 await as(20,()=>db.query("SELECT api.save_product($1,$2,'Fish','Local','Description','/assets/new.jpg','[1000]','[{\"name\":\"Whole\"}]',true)",[product,child]));
 assert.equal((await as(null,()=>scalar("SELECT api.catalogue($1,$2) AS value",[id(10),category]),"anon")).value.products.length,1);
 await as(20,()=>db.query("SELECT api.save_category($1,'Fish',NULL,1,false)",[category]));
 assert.equal((await as(null,()=>scalar("SELECT api.catalogue($1) AS value",[id(10)]),"anon")).value.products.length,0);
 assert.equal((await as(21,()=>scalar("SELECT api.daily_products($1) AS value",[id(10)]))).value.length,0);
 const version=(await scalar("SELECT version FROM app.product_store_settings WHERE id=$1",[offering])).version;
 await denied(21,"SELECT api.update_daily_product($1,$2,70000,true)",[offering,version]);
 await as(20,()=>db.query("SELECT api.save_category($1,'Fish',NULL,1,true)",[category]));
});
await check("cross-business normalized references and anonymous direct tables fail",async()=>{
 for(const table of ["product_images","preparation_options","product_preparation_options","product_allowed_weights"]) {
 await denied(null,"SELECT * FROM app."+table,[],"anon");
 await denied(21,"DELETE FROM app."+table);
 }
 await assert.rejects(()=>db.query("INSERT INTO app.product_allowed_weights(business_id,product_id,raw_weight_grams) VALUES ($1,$2,250)",[id(2),product]));
 assert.equal((await scalar("SELECT count(*)::int AS n FROM app.product_prices")).n,3);
});
await check("forward conversion of preexisting JSON catalogue preserves source records",async()=>{
 const old=new PGlite();
 try{
 await old.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY); CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;");
 await old.exec(foundation);await old.exec(migration);
 await old.query("INSERT INTO app.businesses(id,slug,display_name) VALUES ($1,'legacy','Legacy')",[id(100)]);
 await old.query("INSERT INTO app.categories(id,business_id,name) VALUES ($1,$2,'Fish')",[id(101),id(100)]);
 await old.query("INSERT INTO app.products(id,business_id,category_id,name,image_path,allowed_weights,preparations) VALUES ($1,$2,$3,'Legacy','/assets/legacy.jpg','[250,1000]','[{\"name\":\"Whole\"},{\"name\":\"Cleaned\",\"cleaning_loss_percent\":19.75}]')",[id(102),id(100),id(101)]);
 const before=(await old.query("SELECT id,name,allowed_weights,preparations,image_path FROM app.products")).rows;
 await old.exec(catalogue);
 assert.deepEqual((await old.query("SELECT id,name,allowed_weights,preparations,image_path FROM app.products")).rows,before);
 assert.equal((await old.query("SELECT count(*)::int AS n FROM app.product_images")).rows[0].n,1);
 assert.equal((await old.query("SELECT count(*)::int AS n FROM app.product_allowed_weights")).rows[0].n,2);
 assert.equal((await old.query("SELECT count(*)::int AS n FROM app.product_preparation_options")).rows[0].n,2);
 }finally{await old.close();}
});
console.log("Phase 5B.2: "+checks+" database validation groups passed.");
await db.close();
