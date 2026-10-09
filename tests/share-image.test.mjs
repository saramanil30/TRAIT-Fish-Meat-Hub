import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";
const source=readFileSync(new URL("../src/lib/share-image.ts",import.meta.url),"utf8");
const {jpegSize,validShareJpeg}=await import("data:text/javascript;base64,"+Buffer.from(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText).toString("base64"));
/** A minimal JPEG header: SOI, an APP0 segment, then a start-of-frame with the given size (padded to the given byte length). */
function jpeg(width,height,{sof=0xc0,bytes=200}={}){
 const head=[0xff,0xd8, 0xff,0xe0,0,16,...Buffer.from("JFIF\0"),1,1,0,0,1,0,1,0,0, 0xff,0xc4,0,4,0,0, 0xff,sof,0,17,8,height>>8,height&255,width>>8,width&255,3];
 const out=new Uint8Array(Math.max(bytes,head.length+20));out.set(head);return out;
}
test("link preview image must be a 1200×630 JPEG of at most 300 KB, read from the frame header",()=>{
 assert.deepEqual(jpegSize(jpeg(1200,630)),{width:1200,height:630});
 assert.equal(validShareJpeg(jpeg(1200,630)),true);
 assert.equal(validShareJpeg(jpeg(1200,630,{sof:0xc2})),true); // progressive
 assert.equal(validShareJpeg(jpeg(1200,631)),false);
 assert.equal(validShareJpeg(jpeg(630,1200)),false);
 assert.equal(validShareJpeg(jpeg(1200,630,{bytes:300*1024+1})),false);
 assert.equal(validShareJpeg(jpeg(1200,630,{bytes:300*1024})),true);
 const png=jpeg(1200,630);png[0]=0x89;assert.equal(validShareJpeg(png),false);
 assert.equal(validShareJpeg(new Uint8Array([0xff,0xd8,0xff,0xe0,0,1])),false);
});
