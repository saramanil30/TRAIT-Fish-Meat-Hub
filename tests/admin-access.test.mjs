import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";
function moduleUrl(source) {return "data:text/javascript;base64,"+Buffer.from(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText).toString("base64");}
const permissionsUrl=moduleUrl(readFileSync(new URL("../src/lib/admin/permissions.ts",import.meta.url),"utf8"));
const permissions=await import(permissionsUrl);
test("role capability matrix denies OWNER catalogue and all EMPLOYEE product operations",()=>{
 for(const section of permissions.staffSections) {
 assert.equal(permissions.canAccessSection("ADMIN",section),true);
 assert.equal(permissions.canAccessSection("OWNER",section),!["catalogue","categories"].includes(section));
 assert.equal(permissions.canAccessSection("EMPLOYEE",section),["dashboard","orders"].includes(section));
 assert.equal(permissions.canAccessSection("forged",section),false);
 }
 assert.equal(permissions.canManageCatalogue("OWNER"),false);
 assert.equal(permissions.canManageDailyProducts("EMPLOYEE"),false);
});
test("daily price parser rejects coercion, overflow and fractional paise",()=>{
 assert.equal(permissions.parseDailyPrice("980.25"),98025);
 for(const value of [""," ","0","-1","Infinity","1e3","1.001","1000000.01","0x10"]) assert.throws(()=>permissions.parseDailyPrice(value));
});
const state={cookie:"test-token",role:"OWNER",active:true,calls:[],authValid:true};
const cookieUrl=moduleUrl("export async function cookies(){return globalThis.__staffTestCookies;}");
globalThis.__staffTestCookies={get:()=>state.cookie?{value:state.cookie}:undefined,set:(name,value,options)=>{state.cookie=value;state.cookieOptions=options;},delete:()=>{state.cookie=null;}};
const serverSource=readFileSync(new URL("../src/lib/admin/server.ts",import.meta.url),"utf8")
 .replace('import "server-only";','').replace('"next/headers"',JSON.stringify(cookieUrl)).replace('"./permissions"',JSON.stringify(permissionsUrl)).replace('"../share-image"',JSON.stringify(moduleUrl(readFileSync(new URL("../src/lib/share-image.ts",import.meta.url),"utf8"))));
const serverUrl=moduleUrl(serverSource);
const server=await import(serverUrl);
const navUrl=moduleUrl('export function redirect(path){throw new Error("REDIRECT:"+path);}');
const cacheUrl=moduleUrl('export function revalidatePath(){}');
const actions=await import(moduleUrl(readFileSync(new URL("../src/app/admin/actions.ts",import.meta.url),"utf8")
 .replace('"next/headers"',JSON.stringify(cookieUrl)).replace('"next/navigation"',JSON.stringify(navUrl)).replace('"next/cache"',JSON.stringify(cacheUrl))
 .replace('"@/lib/checkout-server"',JSON.stringify(moduleUrl('export async function rateLimit(){}'))).replace('"@/lib/admin/server"',JSON.stringify(serverUrl)).replace('"@/lib/admin/permissions"',JSON.stringify(permissionsUrl))));
const offerActions=await import(moduleUrl(readFileSync(new URL("../src/app/admin/offer-actions.ts",import.meta.url),"utf8").replace('"next/cache"',JSON.stringify(cacheUrl)).replace('"@/lib/admin/server"',JSON.stringify(serverUrl))));
const originalFetch=globalThis.fetch;
const env={...process.env};
test("server Auth validation, current membership, and forged direct actions",async()=>{
 process.env.TRAIT_STAFF_ENABLED="true";process.env.SUPABASE_URL="https://synthetic.invalid";process.env.SUPABASE_PUBLISHABLE_KEY="test-publishable";
 globalThis.fetch=async(url,options)=>{
  state.calls.push({url,options});
  if(url.includes("/token?grant_type=password")) return new Response(JSON.stringify({access_token:"signed-token",expires_in:3600}));
  if(url.endsWith("/auth/v1/user")) return new Response(JSON.stringify({id:"synthetic"}),{status:state.authValid?200:401});
  if(url.endsWith("/staff_context")) return new Response(JSON.stringify(state.active?{id:"synthetic",businessId:"business",role:state.role,name:"Sample",stores:[]}:{}),{status:state.active?200:403});
  return new Response("null");
 };
 try {
 assert.equal((await server.requireStaff("prices")).context.role,"OWNER");
 const form=new FormData();form.set("kind","category");form.set("name","Forged");form.set("role","ADMIN");
 state.calls=[];
 assert.ok((await actions.saveMaster({},form)).error);
 assert.equal(state.calls.some(c=>c.url.endsWith("/save_category")),false);
 state.role="EMPLOYEE";state.calls=[];
 const price=new FormData();price.set("id","00000000-0000-4000-8000-000000000001");price.set("version","1");price.set("price","500");price.set("available","true");price.set("stockVersion","0");price.set("stock","2.5");price.set("weighed","true");
 assert.ok((await actions.saveDailyProduct({},price)).error);
 assert.equal(state.calls.some(c=>c.url.endsWith("/save_daily_product")),false);
 const offerForm=new FormData();for(const [k,v] of Object.entries({store:"00000000-0000-4000-8000-000000000001",title:"Sale",message:"",kind:"PERCENT",amount:"10",start:"2026-09-29T00:00",end:"2026-10-01T00:00",scope:"STORE",active:"true"}))offerForm.set(k,v);
 state.calls=[];assert.ok((await offerActions.saveOffer({},offerForm)).error);assert.equal(state.calls.some(c=>c.url.endsWith("/save_offer")),false);
 state.role="OWNER";state.calls=[];assert.ok((await offerActions.saveOffer({},offerForm)).success);
 assert.equal(JSON.parse(state.calls.find(c=>c.url.endsWith("/save_offer")).options.body).amount,1000);
 state.role="OWNER";state.calls=[];
 assert.ok((await actions.saveDailyProduct({},price)).success);
 const request=state.calls.find(c=>c.url.endsWith("/save_daily_product"));
 assert.deepEqual(JSON.parse(request.options.body),{offering:price.get("id"),expected_version:1,price_paise:50000,is_available:true,expected_stock_version:0,stock:2500});
 assert.equal(request.options.headers.Authorization,"Bearer test-token");
 assert.equal(request.options.headers["Content-Profile"],"api");
 assert.equal(request.options.cache,"no-store");
 const login=new FormData();login.set("email","synthetic@example.invalid");login.set("password","synthetic-test-only");login.set("role","ADMIN");
 for(const role of ["ADMIN","OWNER","EMPLOYEE"]){state.role=role;await assert.rejects(()=>actions.signIn({},login),new RegExp("REDIRECT:/admin/"+role.toLowerCase()+"/dashboard"));}
 assert.equal(state.cookieOptions.httpOnly,true);assert.equal(state.cookieOptions.sameSite,"strict");assert.equal(state.cookieOptions.path,"/admin");assert.equal(state.cookieOptions.maxAge,3600);
 state.role="OWNER";state.active=false;assert.ok((await actions.signIn({},login)).error);
 state.active=false;await assert.rejects(()=>server.requireStaff("prices"));
 state.active=true;state.authValid=false;await assert.rejects(()=>server.requireStaff("prices"));
 state.authValid=true;state.role="forged";await assert.rejects(()=>server.requireStaff());
 state.role="OWNER";state.cookie=null;await assert.rejects(()=>server.requireStaff());
 } finally {globalThis.fetch=originalFetch;for(const name of ["TRAIT_STAFF_ENABLED","SUPABASE_URL","SUPABASE_PUBLISHABLE_KEY"]){if(env[name]===undefined)delete process.env[name];else process.env[name]=env[name];}delete globalThis.__staffTestCookies;}
});
test("admin money inputs are rupees, stored as paise", () => {
 assert.equal(permissions.rupeesToPaise("50"),5000);
 assert.equal(permissions.rupeesToPaise("49.5"),4950);
 assert.equal(permissions.rupeesToPaise(" 0.01 "),1);
 assert.equal(permissions.rupeesToPaise("0"),0);
 assert.equal(permissions.rupeesToPaise("50000"),5000000);
 for(const bad of ["","-5","1.234","₹50","5e3","abc","1234567890"]) assert.throws(()=>permissions.rupeesToPaise(bad));
});
test("stock today: blank is unlimited, kg become grams, packs are whole numbers",()=>{
 assert.equal(permissions.parseStock("",true),null);
 assert.equal(permissions.parseStock(" 2.5 ",true),2500);
 assert.equal(permissions.parseStock("0",false),0);
 assert.equal(permissions.parseStock("12",false),12);
 for(const [value,weighed] of [["-1",true],["1.2345",true],["1.5",false],["abc",false]])assert.throws(()=>permissions.parseStock(value,weighed));
});
