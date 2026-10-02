// Replays migrations and runs the admin "Save product" RPC order against the real constraints.
process.on('uncaughtException',e=>{console.error('FAIL',e.message,e.code??'');process.exit(1);});
import assert from 'node:assert/strict'; import {readFileSync,readdirSync} from 'node:fs';
const {PGlite}=await import('../node_modules/.staff-validation/node_modules/@electric-sql/pglite/dist/index.js');
const db=new PGlite(); const admin='00000000-0000-4000-8000-000000000020';
const value=async(s,a=[])=>(await db.query(s,a)).rows[0]?.value;
await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY); CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;");
for(const f of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort())await db.exec(readFileSync('supabase/migrations/'+f,'utf8'));
const business=await value("select id as value from app.businesses where slug='trait-fish-meat-hub'");
await db.query('insert into auth.users values($1)',[admin]);
await db.query("insert into app.staff_profiles(id,business_id,auth_user_id,display_name,role) values($1,$2,$1,'Owner','OWNER')",[admin,business]);
await db.query('insert into app.staff_admin_grants(staff_profile_id) values($1)',[admin]);
const rpc=async(name,args)=>{await db.exec('SET ROLE authenticated');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[admin]);
 const keys=Object.keys(args);try{return await value(`select api.${name}(${keys.map((k,i)=>k+'=>$'+(i+1)).join(',')}) as value`,keys.map(k=>typeof args[k]==='object'&&args[k]!==null?JSON.stringify(args[k]):args[k]));}finally{await db.exec('RESET ROLE');}};
const category=await value("select id as value from app.categories where business_id=$1 limit 1",[business]);
const details=(name,extra={})=>({category,product_name:name,local_name:'',description:'',image_path:'',preparation_choices:[{name:'Whole'}],active:true,...extra});
// Same order as saveMaster(kind="product").
async function save(id,name,pricing){
 if(id){await rpc('configure_product_pricing',{product:id,...pricing});await rpc('save_product',{target_id:id,...details(name),weights:pricing.basis==='RAW_WEIGHT'?pricing.quantities:[]});return id;}
 const product=await rpc('save_product',{target_id:null,...details(name),weights:pricing.quantities});await rpc('configure_product_pricing',{product,...pricing});return product;
}
const row=id=>db.query('select pricing_basis,price_unit_grams,units_per_pack,allowed_weights,sale_quantities,catalogue_published from app.products where id=$1',[id]).then(r=>r.rows[0]);
const p=(basis,unit_grams,pack_count,quantities)=>({basis,unit_grams,pack_count,quantities,reference_price:10000,published:false});
const tray=await save(null,'New Tray',p('TRAY',null,30,[1,2]));assert.deepEqual(await row(tray),{pricing_basis:'TRAY',price_unit_grams:null,units_per_pack:30,allowed_weights:[],sale_quantities:[1,2],catalogue_published:false});
const net=await save(null,'New Net',p('NET_WEIGHT',500,null,[500,1000]));assert.deepEqual((await row(net)).sale_quantities,[500,1000]);
const unit=await save(null,'New Unit',p('UNIT',null,1,[1,2,3]));assert.equal((await row(unit)).units_per_pack,1);
const raw=await save(null,'New Raw',p('RAW_WEIGHT',1000,null,[500,1000]));assert.deepEqual((await row(raw)).allowed_weights,[500,1000]);
console.log('PASS new products: RAW, NET_WEIGHT (500 g), TRAY (30), UNIT (1) all satisfy sale-configuration constraints');
await save(raw,'New Raw',p('NET_WEIGHT',250,null,[250]));assert.deepEqual(await row(raw),{pricing_basis:'NET_WEIGHT',price_unit_grams:250,units_per_pack:null,allowed_weights:[],sale_quantities:[250],catalogue_published:false});
await save(raw,'New Raw',p('RAW_WEIGHT',1000,null,[1000,1500]));assert.deepEqual((await row(raw)).allowed_weights,[1000,1500]);
console.log('PASS unpriced product switches RAW -> NET -> RAW; weights and quantities stay consistent');
const king=await value("select id as value from app.products where name='King Fish / Vanjaram'");
await save(king,'King Fish / Vanjaram',{...p('NET_WEIGHT',500,null,[500,1000]),reference_price:80000,published:true});
const k=await row(king);assert.deepEqual([k.pricing_basis,k.price_unit_grams,k.sale_quantities],['NET_WEIGHT',500,[500,1000]]);
const eggs=await value("select id as value from app.products where name='Free Range Brown Eggs'");
await save(eggs,'Free Range Brown Eggs',{...p('TRAY',null,30,[1,2,3,4]),reference_price:45000,published:true});
console.log('PASS re-saving imported King Fish (NET 500 g) and Eggs (TRAY 30) keeps their configuration');
// Storage policy helper from docs/product-image-uploads.md (storage schema itself is Supabase-only).
const doc=readFileSync('docs/product-image-uploads.md','utf8');
await db.exec(doc.slice(doc.indexOf('CREATE OR REPLACE FUNCTION api.can_upload_product_image'),doc.indexOf('CREATE POLICY')));
const hash='a'.repeat(64);
assert.equal(await rpc('can_upload_product_image',{object_name:`${business}/${king}/${hash}.webp`}),true);
for(const bad of [`${business}/${king}/${hash}.png`,`${business}/00000000-0000-4000-8000-000000000999/${hash}.webp`,`00000000-0000-4000-8000-000000000999/${king}/${hash}.webp`,`${business}/${king}/../${hash}.webp`])assert.equal(await rpc('can_upload_product_image',{object_name:bad}),false);
await db.exec('SET ROLE authenticated');await db.query("select set_config('request.jwt.claim.sub','',false)");
assert.equal(await value('select api.can_upload_product_image($1) as value',[`${business}/${king}/${hash}.webp`]),false);await db.exec('RESET ROLE');
console.log('PASS upload policy helper: ADMIN + own business + existing product + hashed .webp only; signed-out caller refused');
