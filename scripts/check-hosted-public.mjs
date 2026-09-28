import assert from "node:assert/strict";
process.loadEnvFile(".env.local");
const root=process.env.SUPABASE_URL,key=process.env.SUPABASE_PUBLISHABLE_KEY;
if(!root||!key)throw new Error("Public connection configuration required.");
const call=(name,args={},schema="api")=>fetch(root+"/rest/v1/rpc/"+name,{method:"POST",headers:{apikey:key,"Content-Type":"application/json","Content-Profile":schema,"Accept-Profile":schema},body:JSON.stringify(args)});
const missing="00000000-0000-4000-8000-000000000000";
for(const name of ["catalogue","storefront_info"]){const r=await call(name,{target_store:missing});assert.equal(r.status,200,name+" available");const body=await r.json();if(name==="storefront_info")assert.equal(body,null);else assert.equal(body.products.length,0);}
for(const [name,args] of [["staff_context",{}],["order_queue_page",{target_store:missing}],["operations_report",{target_store:missing,from_date:new Date().toISOString(),until_date:new Date(Date.now()+1000).toISOString()}]]){const r=await call(name,args);assert.ok(!r.ok,name+" rejects anonymous caller");}
const privateTable=await fetch(root+"/rest/v1/orders?select=id",{headers:{apikey:key,"Accept-Profile":"app"}});assert.ok(!privateTable.ok,"app schema is not exposed");
console.log("PASS hosted public RPC access, empty-store behavior, staff/report/queue denial and private schema isolation. No rows written.");
