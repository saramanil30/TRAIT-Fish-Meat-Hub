import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
const {PGlite}=await import("../../node_modules/.staff-validation/node_modules/@electric-sql/pglite/dist/index.js");
const db=new PGlite();
const root=new URL("./",import.meta.url);
const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
const one=async(sql,args=[])=>(await q(sql,args))[0];
const value=async(sql,args=[])=>(await one(sql,args)).value;
let checks=0;
const check=async(name,fn)=>{await fn();console.log("PASS "+name);checks++;};
const bad=async(sql,args=[],code)=>assert.rejects(()=>db.query(sql,args),e=>!code||e.code===code);
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY); CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;");
const prior=[
 ["20260923041240_phase_5b_1_foundation.sql","bfa3e52b3ae8095b84844743b0284fda"],
 ["20260926000000_staff_access.sql","d31acd506ee7729faf2eb7ee1aca3369"],
 ["20260926120000_phase_5b_2_catalogue.sql","7282a074b2ffb41c05376ff30a4ad7bb"]
];
for(const [file,hash] of prior){
 const sql=readFileSync(new URL("../migrations/"+file,root),"utf8");
 assert.equal(createHash("md5").update(sql).digest("hex"),hash,"Previous migration unchanged");
 await db.exec(sql);
}
const snapshotSQL=readFileSync(new URL("schema-snapshot.sql",root),"utf8");
const before=await one(snapshotSQL);
writeFileSync(new URL("phase-5b-3-baseline.json",root),JSON.stringify(before.snapshot,null,2));
const sql=readFileSync(new URL("../migrations/20260926140000_phase_5b_3_customers_delivery.sql",root),"utf8");
await db.exec(sql);
const after=await one(snapshotSQL);
writeFileSync(new URL("phase-5b-3-expected.json",root),JSON.stringify(after.snapshot,null,2));
await check("forward migration preserves all existing table/function definitions and privileges",async()=>{
 for(const key of ["columns","constraints","indexes","triggers","functions","tables"]){
  for(const item of before.snapshot[key])assert.ok(after.snapshot[key].some(x=>JSON.stringify(x)===JSON.stringify(item)),key+" "+item.slice(0,3));
 }
 assert.equal(after.snapshot.tables.length,18);assert.equal(after.snapshot.policies,0);
});
await check("all tables force RLS; browser/service roles have no private table access",async()=>{
 const rows=await q("SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS granted FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN pg_roles r WHERE n.nspname='app' AND c.relkind='r' AND r.rolname IN ('anon','authenticated','service_role')");
 for(const r of rows){assert.ok(r.relrowsecurity&&r.relforcerowsecurity);assert.equal(r.granted,false);}
});
async function as(n,fn,role="authenticated"){
 await db.exec("SET ROLE "+role);await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[n?id(n):""]);
 try{return await fn();}finally{await db.exec("RESET ROLE");}
}
async function denied(n,sql,args=[],role="authenticated"){await assert.rejects(()=>as(n,()=>db.query(sql,args),role),e=>e.code==="42501");}
await check("Indian phone formats normalize; missing, foreign and malformed numbers fail",async()=>{
 for(const input of ["9876543210","+91 98765-43210","919876543210","09876543210","(+91) 98765 43210"])
 assert.equal(await value("SELECT app.normalize_indian_mobile($1) AS value",[input]),"+919876543210");
 for(const input of [null,"","12345","+1 9876543210","5876543210","98765abc43210","91+9876543210","++919876543210","00919876543210","9".repeat(41)])
 await bad("SELECT app.normalize_indian_mobile($1)",[input],"22023");
});
await db.query("INSERT INTO app.businesses(id,slug,display_name) VALUES ($1,'test','Test'),($2,'other','Other')",[id(1),id(2)]);
await db.query("INSERT INTO app.stores(id,business_id,code,name,address_line1,city,state,delivery_enabled,pickup_enabled) VALUES ($1,$2,'main','Main','Test','Test','Test',true,true),($3,$2,'branch','Branch','Test','Test','Test',true,false),($4,$5,'other','Other','Test','Test','Test',true,true)",[id(10),id(1),id(11),id(12),id(2)]);
for(const [n,business,role] of [[20,1,"OWNER"],[21,1,"OWNER"],[22,1,"EMPLOYEE"],[23,2,"OWNER"],[24,1,"EMPLOYEE"]]){
 await db.query("INSERT INTO auth.users VALUES ($1)",[id(n)]);
 await db.query("INSERT INTO app.staff_profiles(id,business_id,auth_user_id,display_name,role) VALUES ($1,$2,$1,'Test',$3)",[id(n),id(business),role]);
}
await db.query("INSERT INTO app.staff_admin_grants(staff_profile_id) VALUES ($1),($2)",[id(20),id(23)]);
await db.query("INSERT INTO app.staff_store_assignments(business_id,store_id,staff_profile_id) VALUES ($1,$2,$3)",[id(1),id(10),id(22)]);
const save="SELECT api.save_delivery_area($1,$2,$3,$4,$5,$6,$7,$8) AS value";
let area;
await check("ADMIN and OWNER configure scoped delivery rules and immutable audit",async()=>{
 area=await as(20,()=>value(save,[null,id(10),null,"560001","Main",3000,20000,true]));
 await as(21,()=>value(save,[area,id(10),1,"560001","Main revised",4000,25000,true]));
 const row=await one("SELECT * FROM app.delivery_areas WHERE id=$1",[area]);assert.equal(row.version,2);assert.equal(row.delivery_fee_paise,4000);
 assert.equal((await as(21,()=>value("SELECT api.delivery_areas($1) AS value",[id(10)]))).length,1);
 assert.equal((await one("SELECT count(*)::int AS n FROM app.staff_access_audit WHERE action='DELIVERY_AREA_SAVED'")).n,2);
 await bad("DELETE FROM app.staff_access_audit",[],"42501");
});
await check("EMPLOYEE, nonstaff, anonymous and foreign ADMIN cannot configure or inspect rules",async()=>{
 for(const n of [22,23,99]){
  await denied(n,save,[area,id(10),2,"560001","Forged",0,0,true]);
  await denied(n,"SELECT api.delivery_areas($1)",[id(10)]);
 }
 await denied(null,save,[null,id(10),null,"560002","Forged",0,0,true],"anon");
 await denied(21,save,[null,id(12),null,"560001","Forged",0,0,true]);
});
await check("stale updates, duplicate store pincodes and invalid values roll back without audit",async()=>{
 const count=await one("SELECT count(*)::int AS n FROM app.staff_access_audit");
 await assert.rejects(()=>as(21,()=>db.query(save,[area,id(10),1,"560001","Stale",0,0,true])),e=>e.code==="40001");
 await assert.rejects(()=>as(21,()=>db.query(save,[null,id(10),null,"560001","Duplicate",0,0,true])),e=>e.code==="23505");
 for(const [pin,fee,min,active] of [["056001",0,0,true],["56001",0,0,true],["560002",-1,0,true],["560002",0,-1,true],["560002",null,0,true],["560002",0,0,null],["560002",1000000000001,0,true]]){
  await assert.rejects(()=>as(21,()=>db.query(save,[null,id(10),null,pin,"Invalid",fee,min,active])));
 }
 assert.deepEqual(await one("SELECT count(*)::int AS n FROM app.staff_access_audit"),count);
});
await check("same pincode has independent store fee/minimum and pickup configuration",async()=>{
 await as(21,()=>value(save,[null,id(11),null,"560001","Branch",0,10000,true]));
 const a=await as(null,()=>value("SELECT api.fulfillment_options($1,$2) AS value",[id(10),"560001"]),"anon");
 const b=await as(null,()=>value("SELECT api.fulfillment_options($1,$2) AS value",[id(11),"560001"]),"anon");
 assert.equal(a.homeDelivery,true);assert.equal(a.storePickup,true);assert.equal(a.deliveryRule.feePaise,4000);
 assert.equal(b.homeDelivery,true);assert.equal(b.storePickup,false);assert.equal(b.deliveryRule.feePaise,0);
 for(const pin of [null,"999999","bad"]){const r=await value("SELECT api.fulfillment_options($1,$2) AS value",[id(10),pin]);assert.equal(r.homeDelivery,false);assert.equal(r.storePickup,true);}
});
const address={line1:" House 1 ",city:"Bengaluru",state:"Karnataka",pincode:"560001"};
const guest="SELECT app.validate_guest_fulfillment($1,$2,$3,$4,$5,$6) AS value";
await check("guest validation requires mobile for both methods and never creates/resolves a customer",async()=>{
 const r=await value(guest,[id(10),"HOME_DELIVERY","9876543210"," Guest ",address,25000]);
 assert.equal(r.mobileE164,"+919876543210");assert.equal(r.name,"Guest");assert.equal(r.address.line1,"House 1");assert.equal(r.deliveryRule.feePaise,4000);
 const pickup=await value(guest,[id(10),"STORE_PICKUP","9876543210",null,null,0]);
 assert.equal(pickup.address,null);assert.equal(pickup.deliveryRule,null);
 for(const method of ["HOME_DELIVERY","STORE_PICKUP"])await bad(guest,[id(10),method,null,"Guest",address,25000],"22023");
 assert.equal((await one("SELECT count(*)::int AS n FROM app.customers")).n,0);
});
await check("delivery requires complete valid address, name, eligible pincode and minimum",async()=>{
 for(const addr of [null,{},[],{...address,pincode:"999999"},{...address,city:null},{...address,line1:" "},{...address,line1:"x".repeat(241)},{...address,countryCode:"US"},{...address,customerId:id(99)}])
 await bad(guest,[id(10),"HOME_DELIVERY","9876543210","Guest",addr,25000],"22023");
 await bad(guest,[id(10),"HOME_DELIVERY","9876543210",null,address,25000],"22023");
 await bad(guest,[id(10),"HOME_DELIVERY","9876543210","Guest",address,24999],"22023");
 for(const method of [null,"DRONE"])await bad(guest,[id(10),method,"9876543210","Guest",address,25000],"22023");
 await bad(guest,[id(11),"STORE_PICKUP","9876543210",null,null,0],"22023");
});
await check("inactive areas, store switches and retired business/store fail closed",async()=>{
 await as(21,()=>value(save,[area,id(10),2,"560001","Main",4000,25000,false]));
 assert.equal((await value("SELECT api.fulfillment_options($1,'560001') AS value",[id(10)])).homeDelivery,false);
 await as(21,()=>value(save,[area,id(10),3,"560001","Main",4000,25000,true]));
 for(const [table,col] of [["stores","delivery_enabled"],["stores","is_active"],["businesses","is_active"]]){
  const target=table==="stores"?id(10):id(1);
  await db.query("UPDATE app."+table+" SET "+col+"=false WHERE id=$1",[target]);
  assert.equal((await value("SELECT api.fulfillment_options($1,'560001') AS value",[id(10)])).homeDelivery,false);
  await bad(guest,[id(10),"HOME_DELIVERY","9876543210","Guest",address,25000],"22023");
  await db.query("UPDATE app."+table+" SET "+col+"=true WHERE id=$1",[target]);
 }
});
let customer,addrId;
await check("customer UUID identity, normalized phones, duplicate contacts and verified-link constraints",async()=>{
 customer=await value("INSERT INTO app.customers(business_id,mobile_e164) VALUES ($1,'98765-43210') RETURNING id AS value",[id(1)]);
 await db.query("INSERT INTO app.customers(business_id,mobile_e164) VALUES ($1,'+919876543210')",[id(1)]);
 assert.equal((await one("SELECT mobile_e164,auth_user_id,mobile_verified_at FROM app.customers WHERE id=$1",[customer])).auth_user_id,null);
 await bad("INSERT INTO app.customers(business_id,mobile_e164,mobile_verified_at) VALUES ($1,'9876543210',now())",[id(1)],"23514");
 await bad("INSERT INTO app.customers(business_id,mobile_e164,auth_user_id) VALUES ($1,'9876543210',$2)",[id(1),id(20)],"23514");
 await db.query("INSERT INTO auth.users VALUES ($1)",[id(30)]);
 await db.query("UPDATE app.customers SET auth_user_id=$1,mobile_verified_at=now() WHERE id=$2",[id(30),customer]);
 await bad("UPDATE app.customers SET mobile_e164='9876543211' WHERE id=$1",[customer],"23514");
 await bad("UPDATE app.customers SET auth_user_id=$1 WHERE id=$2",[id(20),customer],"23514");
 await bad("INSERT INTO app.customers(business_id,mobile_e164,auth_user_id,mobile_verified_at) VALUES ($1,'9876543211',$2,now())",[id(1),id(30)],"23505");
});
await check("saved addresses enforce business/customer ownership and immutable provenance",async()=>{
 const insert="INSERT INTO app.customer_addresses(business_id,customer_id,recipient_name,recipient_mobile_e164,address_line1,city,state,pincode) VALUES ($1,$2,'Recipient','9876543210','House','City','State','560001') RETURNING id AS value";
 addrId=await value(insert,[id(1),customer]);
 await bad(insert,[id(2),customer],"23503");
 await bad("UPDATE app.customer_addresses SET customer_id=$1 WHERE id=$2",[id(99),addrId],"23514");
 await bad("UPDATE app.customer_addresses SET business_id=$1 WHERE id=$2",[id(2),addrId],"23514");
 for(const table of ["customers","customer_addresses","delivery_areas"])await bad("DELETE FROM app."+table,[],"23514");
 await bad("UPDATE app.delivery_areas SET store_id=$1 WHERE id=$2",[id(11),area],"23514");
});
await check("phone possession, customer Auth session, ADMIN and service role cannot access private customer data",async()=>{
 for(const n of [20,21,22,30,99]){
  for(const table of ["customers","customer_addresses","delivery_areas"])await denied(n,"SELECT * FROM app."+table);
  await denied(n,"UPDATE app.customers SET auth_user_id=$1 WHERE mobile_e164='+919876543210'",[id(n)]);
  await denied(n,guest,[id(10),"STORE_PICKUP","9876543210",null,null,0]);
 }
 for(const role of ["anon","service_role"])await denied(null,"SELECT * FROM app.customers",[],role);
});
await check("disabled staff lose delivery authority and catalogue restrictions remain",async()=>{
 await db.query("UPDATE app.staff_profiles SET is_active=false,disabled_at=now() WHERE id=$1",[id(24)]);
 await denied(24,"SELECT api.delivery_areas($1)",[id(10)]);
 for(const n of [21,22])await denied(n,"SELECT api.save_category(NULL,'Forged',NULL,0,true)");
 await db.query("UPDATE app.businesses SET is_active=false WHERE id=$1",[id(1)]);
 await denied(21,"SELECT api.delivery_areas($1)",[id(10)]);
 await db.query("UPDATE app.businesses SET is_active=true WHERE id=$1",[id(1)]);
});
await check("only safe public projections are anonymous; helpers/service capabilities stay closed",async()=>{
 const rows=await q("SELECT n.nspname,p.proname,p.prosecdef,p.proconfig,has_function_privilege('anon',p.oid,'EXECUTE') AS anon,has_function_privilege('authenticated',p.oid,'EXECUTE') AS staff,has_function_privilege('service_role',p.oid,'EXECUTE') AS service FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('app','api')");
 for(const r of rows){
  assert.equal(r.anon,r.nspname==="api"&&["catalogue","fulfillment_options"].includes(r.proname));
  assert.equal(r.staff,r.nspname==="api");assert.equal(r.service,false);
  if(r.prosecdef)assert.ok(r.proconfig.includes('search_path=""'));
 }
});
console.log("Phase 5B.3: "+checks+" validation groups passed.");
await db.close();
