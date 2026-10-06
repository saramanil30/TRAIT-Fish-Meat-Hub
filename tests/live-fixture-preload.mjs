// Test-process-only HTTP fixture. Never load this module in a deployment.
import {readFileSync} from "node:fs";
import ts from "typescript";
const source=ts.transpileModule(readFileSync(new URL("../src/data/catalog.ts",import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.ES2022}}).outputText;
const {products,categories}=await import("data:text/javascript;base64,"+Buffer.from(source).toString("base64"));
const catalogue={categories:categories.map(c=>({id:c.slug,parentId:null,name:c.slug==="seafood"?"Seafood":c.name})),products:products.map(p=>({id:p.id,name:p.name,localName:p.localName,description:p.cut,categoryId:p.category,pricePerKgPaise:p.pricePerKg*100,available:p.available,images:[{assetPath:p.image,alt:p.imageAlt}],weightsGrams:p.selectableWeightsGrams,preparations:p.preparationOptions.map(o=>({id:o.id,name:o.label,cleaningLossPercent:o.removesCleaningWaste?p.cleaningLossPercent??null:null}))}))};
const testOffer={id:'00000000-0000-4000-8000-000000000010',title:'Fresh test offer',message:'Isolated promotion fixture',kind:'PERCENT',value:1000,endsAt:'2099-01-01T00:00:00Z',scope:'STORE',targetNames:[]};
const original=globalThis.fetch;
globalThis.fetch=async(input,options)=>{
 const url=String(input);
 // TRAIT_TEST_OFFER_COUNT (default 1) adds coded offers to exercise the offer rotation.
 if(url==="https://trait-test.invalid/rest/v1/rpc/store_offers")return Response.json([testOffer,{...testOffer,id:'00000000-0000-4000-8000-000000000011',title:'Weekend seafood saver',message:'Prawns and fish only',kind:'FIXED',value:15000,code:'SEA150',scope:'CATEGORIES',targetNames:['Seafood']},{...testOffer,id:'00000000-0000-4000-8000-000000000012',title:'First order 20% off',message:'New customers',value:2000,code:'WELCOME20'}].slice(0,Number(process.env.TRAIT_TEST_OFFER_COUNT??1)));
 if(url==="https://trait-test.invalid/rest/v1/rpc/catalogue")return Response.json(catalogue);
 if(url==="https://trait-test.invalid/rest/v1/rpc/storefront_info")return Response.json({name:"Isolated test store",address:{line1:"Test Street",city:"Test City",state:"Test State",pincode:"560001"},phone:null,timezone:"Asia/Kolkata",hours:{mon:[{opens:"09:00",closes:"18:00"}]},pickup:true,delivery:true,areas:[{pincode:"560001",name:"Test Area",feePaise:3000,minimumPaise:10000}]});
 if(url==="https://trait-test.invalid/rest/v1/rpc/track_order")return Response.json(JSON.parse(options.body).tracking_token==="a".repeat(64)?{orderNumber:"TFM-999001",status:"PLACED",method:"STORE_PICKUP",paymentStatus:"PENDING",history:[{status:"PLACED",at:"2026-09-27T12:00:00Z"}]}:null);
 if(url==="https://trait-limit.invalid")return Response.json({result:1});
 if(url.startsWith("https://trait-test.invalid/")){
  const token=new Headers(options?.headers).get("Authorization")??"";
  const role=token.replace("Bearer fixture-","");
  if(!["ADMIN","OWNER","EMPLOYEE"].includes(role))return Response.json({error:"denied"},{status:403});
  if(url.endsWith("/auth/v1/user"))return Response.json({id:"00000000-0000-4000-8000-000000000003"});
  if(url.endsWith("/staff_context"))return Response.json({id:"00000000-0000-4000-8000-000000000003",businessId:"00000000-0000-4000-8000-000000000004",name:"Isolated "+role,role,stores:[{id:"00000000-0000-4000-8000-000000000001",name:"Isolated test store"}]});
  if(url.endsWith("/offer_workspace"))return Response.json(role==='EMPLOYEE'?{current:[testOffer]}:{offers:[{id:testOffer.id,title:testOffer.title,message:testOffer.message,discount_kind:'PERCENT',discount_value:1000,starts_at:'2026-01-01T00:00:00Z',ends_at:testOffer.endsAt,scope:'STORE',product_ids:[],category_ids:[],is_active:true,version:1}],products:[],categories:[]});
  if(url.endsWith("/save_offer"))return role==='EMPLOYEE'?Response.json({error:'forbidden'},{status:403}):Response.json(testOffer.id);
  if(url.endsWith("/catalogue_master"))return Response.json({categories:[],products:[]});
  if(url.endsWith("/business_policy"))return Response.json(null);
  if(url.endsWith("/store_operations"))return Response.json({name:"Isolated test store",delivery:false,pickup:false,hours:{}});
  if(url.endsWith("/operations_report"))return Response.json({intake:{count:0,paise:0},fulfillment:{fulfilledPaise:0,cancelled:0},collections:[],balances:[],products:[],activity:[]});
  return Response.json([]);
 }
 return original(input,options);
};
