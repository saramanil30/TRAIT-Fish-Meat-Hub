// Replays migrations: who can edit delivery areas, and the admin "Save" flow (add with an existing pincode updates it).
process.on('uncaughtException',e=>{console.error('FAIL',e.message,e.code??'');process.exit(1);});
import assert from 'node:assert/strict'; import {readFileSync,readdirSync} from 'node:fs';
const {PGlite}=await import('../node_modules/.staff-validation/node_modules/@electric-sql/pglite/dist/index.js');
const db=new PGlite(); const shop='111ac620-b8ea-485d-9cd3-07fb10b65fe7';
const [admin,owner,employee]=['20','21','22'].map(n=>'00000000-0000-4000-8000-0000000000'+n);
const value=async(s,a=[])=>(await db.query(s,a)).rows[0]?.value;
await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY); CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;");
for(const f of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort())await db.exec(readFileSync('supabase/migrations/'+f,'utf8'));
const business=await value("select id as value from app.businesses where slug='trait-fish-meat-hub'");
for(const [who,role] of [[admin,'OWNER'],[owner,'OWNER'],[employee,'EMPLOYEE']]){await db.query('insert into auth.users values($1)',[who]);await db.query("insert into app.staff_profiles(id,business_id,auth_user_id,display_name,role) values($1,$2,$1,$3,$3)",[who,business,role]);}
await db.query('insert into app.staff_admin_grants(staff_profile_id) values($1)',[admin]);
await db.query("insert into app.stores(id,business_id,code,name,timezone,address_line1,locality,city,state,pincode,contact_mobile_e164,opening_hours,delivery_enabled,pickup_enabled) values($1,$2,'kokapet','TRAIT Fish & Meat Hub','Asia/Kolkata','Pipeline Road','Kokapet','Hyderabad','Telangana','500075','+918686146562','{}',true,true)",[shop,business]);
await db.query("insert into app.staff_store_assignments(business_id,staff_profile_id,store_id) values($1,$2,$3)",[business,employee,shop]).catch(()=>{});
await db.query("insert into app.delivery_areas(business_id,store_id,pincode,name,delivery_fee_paise,minimum_order_paise) values($1,$2,'500075','Kokapet',4000,0)",[business,shop]);
const rpc=async(who,name,args)=>{await db.exec('SET ROLE authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[who]);
 const keys=Object.keys(args);try{return await value(`select api.${name}(${keys.map((k,i)=>k+'=>$'+(i+1)).join(',')}) as value`,keys.map(k=>args[k]));}finally{await db.exec('RESET ROLE');}};
const areas=who=>rpc(who,'delivery_areas',{target_store:shop});
// Same resolution as operationalAction(kind="delivery").
async function save(who,form){
 const existing=form.id?null:(await areas(who)).find(a=>a.pincode===form.pincode);
 const target=form.id?{id:form.id,version:form.version}:existing?{id:existing.id,version:Number(existing.version)}:null;
 return rpc(who,'save_delivery_area',{target_id:target?.id??null,target_store:shop,expected_version:target?.version??null,area_pincode:form.pincode,area_name:form.name,fee_paise:form.fee,minimum_paise:form.minimum,active:form.active});
}
const area=async pin=>(await value("select to_jsonb(d) as value from app.delivery_areas d where pincode=$1",[pin]));

await assert.rejects(rpc(admin,'save_delivery_area',{target_id:null,target_store:shop,expected_version:null,area_pincode:'500075',area_name:'Kokapet',fee_paise:5000,minimum_paise:0,active:true}),/delivery_areas_business_id_store_id_pincode_key/);
console.log('PASS reproduced: "Add" with existing pincode 500075 hit the unique pincode rule (the reported failure)');
await save(admin,{pincode:'500075',name:'Kokapet',fee:5000,minimum:0,active:true});
assert.deepEqual([(await area('500075')).delivery_fee_paise,(await area('500075')).version],[5000,2]);
console.log('PASS ADMIN: "Add" with an existing pincode now updates that rule (fee 4000 -> 5000)');
const a=await area('500075');
await save(owner,{id:a.id,version:a.version,pincode:'500075',name:'Kokapet',fee:6000,minimum:20000,active:true});
assert.deepEqual([(await area('500075')).delivery_fee_paise,(await area('500075')).minimum_order_paise],[6000,20000]);
console.log('PASS OWNER edits fee and minimum on the existing rule');
await save(owner,{pincode:'500089',name:'Narsingi',fee:5000,minimum:0,active:true});
const n=await area('500089'); assert.equal(n.is_active,true);
await save(admin,{id:n.id,version:n.version,pincode:'500089',name:'Narsingi',fee:5000,minimum:0,active:false});
assert.equal((await area('500089')).is_active,false);
console.log('PASS add pincode 500089, then remove it (inactive; hard delete stays forbidden)');
await assert.rejects(save(admin,{id:a.id,version:a.version,pincode:'500075',name:'Kokapet',fee:1,minimum:0,active:true}),/reload/);
console.log('PASS stale version is still rejected');
await assert.rejects(areas(employee)); await assert.rejects(save(employee,{id:n.id,version:3,pincode:'500089',name:'Narsingi',fee:1,minimum:0,active:true}));
assert.equal((await area('500089')).delivery_fee_paise,5000);
console.log('PASS EMPLOYEE cannot read or edit delivery areas');
