import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";
function url(s){return "data:text/javascript;base64,"+Buffer.from(ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText).toString("base64");}
const queries=[];
const quote={quoteDigest:"a".repeat(64),subtotalPaise:25000,deliveryFeePaise:1000,totalPaise:26000,items:[{lineTotalPaise:25000,pricePerKgPaise:50000}]};
globalThis.__sql=async(strings,...args)=>{queries.push({sql:strings.join("?"),args});if(strings.join("").includes("pg_roles"))return [{allowed:true}];if(strings.join("").includes("checkout_quote"))return [{result:quote}];return [{result:{id:"private",orderNumber:"TFM-000001"}}];};
const stub=url("export default function postgres(){return globalThis.__sql;}");
const h=url("export async function headers(){return new Headers();}");
const source=readFileSync(new URL("../src/lib/checkout-server.ts",import.meta.url),"utf8").replace('import "server-only";',"").replace('"postgres"',JSON.stringify(stub)).replace('"next/headers"',JSON.stringify(h));
const server=await import(url(source));
process.env.TRAIT_CHECKOUT_ENVELOPE_KEY="1".repeat(64);
process.env.TRAIT_CHECKOUT_DATABASE_URL="test-only";
process.env.TRAIT_STORE_ID="00000000-0000-4000-8000-000000000001";
process.env.TRAIT_TRACKING_EXPIRY_DAYS="7";
test("encrypted checkout envelope hides payload and detects tampering",()=>{
 const sealed=server.seal({mobile:"9999999999",token:"private-token"});
 assert.ok(!sealed.includes("private-token"));assert.deepEqual(server.unseal(sealed),{mobile:"9999999999",token:"private-token"});
 const bytes=Buffer.from(sealed,"base64url");bytes[30]^=1;assert.throws(()=>server.unseal(bytes.toString("base64url")));
});
test("server quote returns display totals and stable retry envelope; placement returns token only",async()=>{
 const result=await server.quoteOrder({items:[]});
 assert.equal(result.grandTotalPaise,26000);
 const envelope=server.unseal(result.envelope);
 assert.match(envelope.token,/^[a-f0-9]{64}$/);
 assert.equal(envelope.digest,quote.quoteDigest);
 assert.deepEqual(Object.keys(await server.commitOrder(result.envelope)),["trackingToken"]);
 await server.commitOrder(result.envelope);
 const placements=queries.filter(q=>q.sql.includes("api.place_order"));
 assert.deepEqual(placements[0].args,placements[1].args);
 assert.ok(!placements[0].args.includes(envelope.token),"database receives digest only");
});
test("server discount and selected offer reach the checkout summary",async()=>{
 Object.assign(quote,{discountPaise:2500,offer:{title:"Fresh savings"},totalPaise:23500});
 const result=await server.quoteOrder({items:[]});
 assert.equal(result.discountPaise,2500);assert.equal(result.offer.title,"Fresh savings");assert.equal(result.grandTotalPaise,23500);
});
test("distributed limiter fails closed without configuration",async()=>{await assert.rejects(()=>server.rateLimit("test",1));});
