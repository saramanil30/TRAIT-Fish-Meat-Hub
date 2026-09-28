import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import sharp from 'sharp';
process.loadEnvFile('.env.local');
const business='645494dc-959f-4048-a3c8-1db863ed3ba1',base=process.env.SUPABASE_URL;
assert.equal(new URL(base).hostname,'igiujohtycixboaohjby.supabase.co');
const management={Authorization:'Bearer '+process.env.SUPABASE_ACCESS_TOKEN,'Content-Type':'application/json'};
async function request(url,options){const r=await fetch(url,{...options,signal:AbortSignal.timeout(30000)});if(!r.ok)throw new Error(new URL(url).pathname+' HTTP '+r.status);return r;}
async function sql(query){return(await request('https://api.supabase.com/v1/projects/igiujohtycixboaohjby/database/query',{method:'POST',headers:management,body:JSON.stringify({query})})).json();}
const lit=v=>"'"+String(v).replaceAll("'","''")+"'";
const file='config/catalogue-image-sources.json',sources=JSON.parse(readFileSync(file,'utf8')),approved=JSON.parse(readFileSync('config/approved-catalogue.json','utf8')).products;
const products=await sql(`select id,name from app.products where business_id='${business}'`);assert.equal(products.length,23);
const held=new Set(['bombay-duck','pabda']);
const keys=await(await request('https://api.supabase.com/v1/projects/igiujohtycixboaohjby/api-keys?reveal=true',{headers:management})).json();
const key=keys.find(k=>k.name==='service_role')?.api_key;assert.ok(key,'Existing service key required');
const headers={apikey:key,Authorization:'Bearer '+key};
const buckets=await(await request(base+'/storage/v1/bucket',{headers})).json();
if(!buckets.some(b=>b.id==='product-images'))await request(base+'/storage/v1/bucket',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({id:'product-images',name:'product-images',public:true,file_size_limit:1048576,allowed_mime_types:['image/webp']})});
else assert.equal(buckets.find(b=>b.id==='product-images').public,true);
for(const[slug,source]of Object.entries(sources)){
 if(held.has(slug)){source.storageStatus='Held: product species requires confirmation';continue;}
 const definition=approved.find(p=>p.key===slug),matches=products.filter(p=>p.name===definition?.name);assert.equal(matches.length,1);const product=matches[0];
 assert.match(source.license,/CC0|Public domain/);
 const bytes=readFileSync('public'+source.assetPath),metadata=await sharp(bytes,{limitInputPixels:1000000}).metadata();
 assert.equal(metadata.format,'webp');assert.equal(metadata.width,800);assert.equal(metadata.height,800);assert.ok(bytes.length<1048576);await sharp(bytes).raw().toBuffer();
 const hash=createHash('sha256').update(bytes).digest('hex'),path=`${business}/${product.id}/${hash}.webp`,url=base+'/storage/v1/object/public/product-images/'+path;
 if(!(await fetch(url)).ok)await request(base+'/storage/v1/object/product-images/'+path,{method:'POST',headers:{...headers,'Content-Type':'image/webp','x-upsert':'false'},body:bytes});
 assert.equal(createHash('sha256').update(Buffer.from(await(await request(url)).arrayBuffer())).digest('hex'),hash);
 await sql(`begin;select id from app.products where id=${lit(product.id)} and business_id=${lit(business)} for update;
 do $map$ declare image uuid; begin
 select id into image from app.product_images where product_id=${lit(product.id)} and storage_bucket='product-images' and storage_object_path=${lit(path)};
 if image is null then
 update app.product_images set is_primary=false where product_id=${lit(product.id)} and is_primary;
 insert into app.product_images(business_id,product_id,storage_bucket,storage_object_path,alt_text,is_primary,is_active,sort_order)values(${lit(business)},${lit(product.id)},'product-images',${lit(path)},${lit(product.name)},true,true,0)returning id into image;
 perform app.core_audit(${lit(business)},null,null,'SYSTEM','OPERATOR_VERIFIED_IMAGE',image,jsonb_build_object('source',${lit(source.sourcePage)},'sha256',${lit(hash)}));
 end if;end $map$;commit;`);
 Object.assign(source,{productId:product.id,storageBucket:'product-images',storageObjectPath:path,sha256:hash,storageStatus:'Uploaded, mapped and public bytes verified',visualReviewDate:'2026-09-29'});
 writeFileSync(file,JSON.stringify(sources,null,2)+'\n');console.log('VERIFIED '+product.name);
}
writeFileSync(file,JSON.stringify(sources,null,2)+'\n');
