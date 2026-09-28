// Read-only verification of the approved hosted catalogue and local image assets.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import sharp from 'sharp';
process.loadEnvFile('.env.local');
const approved=JSON.parse(readFileSync('config/approved-catalogue.json','utf8')).products;
const sources=JSON.parse(readFileSync('config/catalogue-image-sources.json','utf8'));
const response=await fetch(process.env.SUPABASE_URL+'/rest/v1/rpc/business_catalogue',{method:'POST',headers:{apikey:process.env.SUPABASE_PUBLISHABLE_KEY,'Content-Type':'application/json','Content-Profile':'api'},body:JSON.stringify({target_business:process.env.TRAIT_BUSINESS_ID}),signal:AbortSignal.timeout(30000)});
assert.equal(response.status,200);
const data=await response.json();assert.equal(data.products.length,23);
let images=0;
for(const definition of approved){
 const product=data.products.find(p=>p.name===definition.name);assert.ok(product,definition.name);
 assert.equal(product.pricePaise,definition.pricePaise);assert.equal(product.pricingBasis,definition.pricingBasis);assert.equal(product.priceUnitGrams,definition.unitGrams);assert.equal(product.unitsPerPack,definition.unitsPerTray);assert.equal(product.orderable,false);
 for(const image of product.images){const source=sources[definition.key];assert.ok(source);assert.equal(image.assetPath,source.assetPath);assert.equal(product.id,source.productId);const bytes=readFileSync('public'+image.assetPath),meta=await sharp(bytes).metadata();assert.equal(meta.format,'webp');assert.equal(meta.width,800);assert.equal(meta.height,800);await sharp(bytes).raw().toBuffer();images++;}
}
assert.equal(images,8);
console.log('PASS: hosted public catalogue contains 23 exact approved prices/units, eight preserved image mappings with decodable assets, and no orderable products.');
