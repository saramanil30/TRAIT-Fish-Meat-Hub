import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";
const load=(file,replace=s=>s)=>"data:text/javascript;base64,"+Buffer.from(replace(ts.transpileModule(readFileSync(new URL("../src/lib/"+file,import.meta.url),"utf8"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText)).toString("base64");
const hero=load("hero-image.ts");
const {pngSize,validDesktopLogo,validMobileLogo,validIconPng,validBrandPath,brandImageUrl}=await import(load("brand-image.ts",s=>s.replace('"./hero-image"',JSON.stringify(hero))));
/** A minimal PNG: signature and an IHDR chunk with the given size, padded to the given byte length. */
function png(width,height,bytes=100){
 const out=new Uint8Array(Math.max(bytes,33));out.set([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,13,...Buffer.from("IHDR")]);
 new DataView(out.buffer).setUint32(16,width);new DataView(out.buffer).setUint32(20,height);return out;
}
/** A minimal lossless WebP (VP8L) with the given size. */
function webp(width,height,bytes=100){
 const out=new Uint8Array(bytes);out.set(Buffer.from("RIFF"));new DataView(out.buffer).setUint32(4,bytes-8,true);out.set(Buffer.from("WEBPVP8L"),8);out[20]=0x2f;
 new DataView(out.buffer).setUint32(21,((width-1)|((height-1)<<14))>>>0,true);return out;
}
test("logo sizes are read from the PNG or WebP header",()=>{
 assert.deepEqual(pngSize(png(800,200)),{width:800,height:200});
 const jpeg=png(800,200);jpeg[0]=0xff;assert.equal(pngSize(jpeg),null);
 assert.deepEqual(validDesktopLogo(webp(800,200)),{width:800,height:200,type:"webp"});
});
test("desktop logo must be wide, 40–600 px tall, ≤ 2400 px wide and ≤ 512 KB",()=>{
 assert.ok(validDesktopLogo(png(800,200)));assert.ok(validDesktopLogo(png(300,200)));
 assert.equal(validDesktopLogo(png(299,200)),null); // narrower than 1.5:1
 assert.equal(validDesktopLogo(png(400,39)),null);assert.equal(validDesktopLogo(png(1200,601)),null);assert.equal(validDesktopLogo(png(2401,400)),null);
 assert.equal(validDesktopLogo(png(800,200,524289)),null);assert.ok(validDesktopLogo(png(800,200,524288)));
});
test("mobile logo must be square, 192–1024 px; generated icons exactly 32 and 180 px PNG",()=>{
 assert.ok(validMobileLogo(png(512,512)));assert.ok(validMobileLogo(webp(192,192)));
 assert.equal(validMobileLogo(png(512,511)),null);assert.equal(validMobileLogo(png(191,191)),null);assert.equal(validMobileLogo(png(1025,1025)),null);
 assert.equal(validIconPng(png(32,32),32),true);assert.equal(validIconPng(png(33,33),32),false);assert.equal(validIconPng(png(32,32,32769),32),false);
 assert.equal(validIconPng(png(180,180),180),true);assert.equal(validIconPng(webp(180,180),180),false);
});
test("only own-store brand paths become public URLs",()=>{
 const path="00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000010/"+"a".repeat(64)+".png";
 assert.equal(validBrandPath(path),true);assert.equal(validBrandPath("../x.png"),false);assert.equal(validBrandPath(path.replace(".png",".svg")),false);
 assert.equal(brandImageUrl("https://x.supabase.co/",path,3),"https://x.supabase.co/storage/v1/object/public/brand-images/"+path+"?v=3");
});
