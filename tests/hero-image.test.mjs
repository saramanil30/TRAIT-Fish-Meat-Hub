import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";
const source=readFileSync(new URL("../src/lib/hero-image.ts",import.meta.url),"utf8");
const {webpSize,validHeroWebp}=await import("data:text/javascript;base64,"+Buffer.from(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText).toString("base64"));
/** A minimal WebP container whose first chunk carries the given size, padded to `bytes`. */
function webp(kind,width,height,bytes=200){
 const out=new Uint8Array(bytes);const put=(at,s)=>out.set(Buffer.from(s,"latin1"),at);
 put(0,"RIFF");new DataView(out.buffer).setUint32(4,bytes-8,true);put(8,"WEBP");put(12,kind);
 const v=new DataView(out.buffer);
 if(kind==="VP8X"){v.setUint16(24,(width-1)&0xffff,true);out[26]=(width-1)>>16;v.setUint16(27,(height-1)&0xffff,true);out[29]=(height-1)>>16;}
 if(kind==="VP8 "){out.set([0x9d,0x01,0x2a],23);v.setUint16(26,width,true);v.setUint16(28,height,true);}
 if(kind==="VP8L"){out[20]=0x2f;v.setUint32(21,((width-1)|((height-1)<<14))>>>0,true);}
 return out;
}
test("reads WebP width and height from VP8, VP8L and VP8X headers",()=>{
 for(const kind of ["VP8 ","VP8L","VP8X"])assert.deepEqual(webpSize(webp(kind,1920,800)),{width:1920,height:800},kind);
 assert.equal(webpSize(Buffer.from("not a webp at all, just some bytes here")),null);
 const truncated=webp("VP8X",1920,800).subarray(0,150);assert.equal(webpSize(truncated),null);
 const png=webp("VP8 ",1920,800);png.set(Buffer.from("PNG "),8);assert.equal(webpSize(png),null);
});
test("hero photos must be WebP, at least 1600 px wide and at most 1 MB",()=>{
 assert.equal(validHeroWebp(webp("VP8 ",1600,600)),1600);
 assert.equal(validHeroWebp(webp("VP8X",2400,1000)),2400);
 assert.equal(validHeroWebp(webp("VP8L",1599,600)),null);
 assert.equal(validHeroWebp(webp("VP8 ",1920,800,1048576)),1920);
 assert.equal(validHeroWebp(webp("VP8 ",1920,800,1048577)),null);
});
