// Replays migrations: publishing creates a store offering at the reference price; the backfill is re-runnable.
process.on('uncaughtException',e=>{console.error('FAIL',e.message,e.code??'');process.exit(1);});
import assert from 'node:assert/strict'; import {readFileSync,readdirSync} from 'node:fs';
const {PGlite}=await import('../node_modules/.staff-validation/node_modules/@electric-sql/pglite/dist/index.js');
const db=new PGlite(); const admin='00000000-0000-4000-8000-000000000020'; const shop='111ac620-b8ea-485d-9cd3-07fb10b65fe7';
const value=async(s,a=[])=>(await db.query(s,a)).rows[0]?.value;
await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY); CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;");
for(const f of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort())await db.exec(readFileSync('supabase/migrations/'+f,'utf8'));
const business=await value("select id as value from app.businesses where slug='trait-fish-meat-hub'");
await db.query('insert into auth.users values($1)',[admin]);
await db.query("insert into app.staff_profiles(id,business_id,auth_user_id,display_name,role) values($1,$2,$1,'Owner','OWNER')",[admin,business]);
await db.query('insert into app.staff_admin_grants(staff_profile_id) values($1)',[admin]);
await db.query("insert into app.stores(id,business_id,code,name,timezone,address_line1,locality,city,state,pincode,contact_mobile_e164,opening_hours,delivery_enabled,pickup_enabled) values($1,$2,'kokapet','TRAIT Fish & Meat Hub','Asia/Kolkata','Pipeline Road','Kokapet','Hyderabad','Telangana','500075','+918686146562','{}',true,true)",[shop,business]);
const rpc=async(name,args)=>{await db.exec('SET ROLE authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[admin]);
 const keys=Object.keys(args);try{return await value(`select api.${name}(${keys.map((k,i)=>k+'=>$'+(i+1)).join(',')}) as value`,keys.map(k=>typeof args[k]==='object'&&args[k]!==null?JSON.stringify(args[k]):args[k]));}finally{await db.exec('RESET ROLE');}};
const category=await value("select id as value from app.categories where business_id=$1 limit 1",[business]);
const details=name=>({category,product_name:name,local_name:'',description:'',image_path:'',preparation_choices:[{name:'Whole'}],active:true});
// Same order as saveMaster(kind="product").
async function save(id,name,pricing){
 if(id){await rpc('configure_product_pricing',{product:id,...pricing});await rpc('save_product',{target_id:id,...details(name),weights:pricing.basis==='RAW_WEIGHT'?pricing.quantities:[]});return id;}
 const product=await rpc('save_product',{target_id:null,...details(name),weights:pricing.quantities});await rpc('configure_product_pricing',{product,...pricing});return product;
}
const offers=id=>db.query('select o.available,o.version,pr.price_per_kg_paise,pr.unit_price_paise,pr.offering_version from app.product_store_settings o left join app.product_prices pr on pr.offering_id=o.id where o.product_id=$1 order by pr.offering_version',[id]).then(r=>r.rows);
const raw={basis:'RAW_WEIGHT',unit_grams:1000,pack_count:null,quantities:[500,1000],reference_price:32000,published:true};

const chicken=await save(null,'New Chicken',raw);
assert.deepEqual(await offers(chicken),[{available:true,version:1,price_per_kg_paise:32000,unit_price_paise:null,offering_version:1}]);
console.log('PASS publishing a new product creates an available offering at the reference price');
const draft=await save(null,'Draft Fish',{...raw,published:false});
assert.deepEqual(await offers(draft),[]);
const unpriced=await save(null,'Unpriced Fish',{...raw,reference_price:null});
assert.deepEqual(await offers(unpriced),[]);
console.log('PASS unpublished or unpriced products get no offering');
const offering=await value('select id as value from app.product_store_settings where product_id=$1',[chicken]);
await rpc('update_daily_product',{offering,expected_version:1,price_paise:35000,is_available:false});
await save(chicken,'New Chicken',{...raw,reference_price:30000});
assert.deepEqual((await offers(chicken)).map(r=>[r.available,r.offering_version,r.price_per_kg_paise]),[[false,1,32000],[false,2,35000]]);
console.log('PASS re-publishing keeps the existing offering and its daily price and availability');
const eggs=await value("select id as value from app.products where name='Free Range Brown Eggs'");
await save(eggs,'Free Range Brown Eggs',{basis:'TRAY',unit_grams:null,pack_count:30,quantities:[1,2],reference_price:45000,published:true});
assert.deepEqual((await offers(eggs)).map(r=>[r.unit_price_paise,r.price_per_kg_paise]),[[45000,null]]);
console.log('PASS publishing an existing TRAY product records a unit price');
const employee='00000000-0000-4000-8000-000000000021'; await db.query('insert into auth.users values($1)',[employee]);
await db.query("insert into app.staff_profiles(id,business_id,auth_user_id,display_name,role) values($1,$2,$1,'Clerk','EMPLOYEE')",[employee,business]);
await db.exec('SET ROLE authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[employee]);
await assert.rejects(db.query('select api.configure_product_pricing($1,$2,$3,null,$4,$5,true)',[draft,'RAW_WEIGHT',1000,'[500]',32000]));
await db.exec('RESET ROLE');
assert.deepEqual(await offers(draft),[]);
console.log('PASS non-admins still cannot publish');

const before=Number(await value("select count(*) as value from app.product_store_settings"));
const missing=Number(await value("select count(*) as value from app.products p where catalogue_published and catalogue_price_paise is not null and not exists(select 1 from app.product_store_settings o where o.product_id=p.id)"));
assert.ok(missing>0);
const backfill=readFileSync('scripts/backfill-store-offerings.sql','utf8');
await db.exec(backfill);
const after=Number(await value("select count(*) as value from app.product_store_settings"));
assert.equal(after,before+missing);
assert.equal(Number(await value("select count(*) as value from app.product_store_settings o where not exists(select 1 from app.product_prices pr where pr.offering_id=o.id)")),0);
assert.deepEqual((await offers(chicken)).map(r=>r.price_per_kg_paise),[32000,35000]);
await db.exec(backfill);
assert.equal(Number(await value("select count(*) as value from app.product_store_settings")),after);
console.log(`PASS backfill created ${missing} offerings with prices; a second run created none; existing offerings untouched`);
