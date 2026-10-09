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
 if(url==="https://trait-test.invalid/rest/v1/rpc/track_order"&&JSON.parse(options.body).tracking_token==="b".repeat(64))return Response.json({orderNumber:"TFM-999002",status:"PLACED",method:"HOME_DELIVERY",paymentStatus:"PENDING",subtotalPaise:52000,deliveryFeePaise:3000,totalPaise:55000,history:[{status:"PLACED",at:"2026-10-06T12:00:00Z"}]});
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
  // One order per WhatsApp message template (Admin Orders).
  const fixtureOrders=["CONFIRMED","OUT_FOR_DELIVERY","READY","DELIVERED","CANCELLED"].map((status,i)=>({id:'00000000-0000-4000-8000-00000000002'+i,order_number:'TFM-99910'+i,status,fulfillment_method:status==="READY"?"STORE_PICKUP":"HOME_DELIVERY",total_paise:45000+i*100,version:1,created_at:'2026-10-0'+(i+1)+'T06:00:00Z',fulfillment_snapshot:{name:'Test Customer '+i,mobileE164:'+9199999000'+i,address:{line1:'Flat '+i+' Test Street',locality:'Kokapet',city:'Hyderabad',pincode:'500075'}}}));
  if(url.endsWith("/order_queue_page")){const status=JSON.parse(options.body).status_filter;return Response.json(status?fixtureOrders.filter(o=>o.status===status):fixtureOrders);}
  // Mirrors api.sales_report: ADMIN/OWNER only; one row per day in the inclusive range.
  if(url.endsWith("/sales_report")){
   if(role==="EMPLOYEE")return Response.json({code:"42501",message:"Forbidden"},{status:403});
   const {from_day,until_day}=JSON.parse(options.body),daily=[];
   for(let t=Date.parse(from_day+"T00:00:00Z"),i=0;t<=Date.parse(until_day+"T00:00:00Z");t+=86400000,i++)daily.push({day:new Date(t).toISOString().slice(0,10),orders:i%4,revenuePaise:(i%4)*86500+(i%3)*12000});
   return Response.json({from:from_day,until:until_day,daily,summary:{orders:9,revenuePaise:778500,discountPaise:26500,deliveryFeePaise:24000,cancelled:2,cancelledPaise:197500},
    products:[{name:"Free Range Brown Eggs",category:"EGGS",grams:0,packs:3,trays:true,orders:3,revenuePaise:135000},{name:"Seabass / Pandugappa",category:"SEAFOOD",grams:2500,packs:0,trays:false,orders:2,revenuePaise:200000},{name:"Bombay Duck",category:"SEAFOOD",grams:1000,packs:0,trays:false,orders:1,revenuePaise:40000}],
    categories:[{name:"SEAFOOD",grams:3500,packs:0,orders:3,revenuePaise:240000},{name:"EGGS",grams:0,packs:3,orders:3,revenuePaise:135000}],
    payments:[{method:"CASH",orders:6,collectedPaise:85000,pendingPaise:256500,refundedPaise:0},{method:"UPI",orders:3,collectedPaise:350000,pendingPaise:91000,refundedPaise:5000}],
    fulfilment:[{method:"HOME_DELIVERY",orders:7,revenuePaise:690000,deliveryFeePaise:24000},{method:"STORE_PICKUP",orders:2,revenuePaise:88500,deliveryFeePaise:0}],
    coupons:[{code:"SAVE10",title:"Flat 10% off on selected products",uses:2,discountPaise:26500,revenuePaise:248500}],
    cancellations:[{orderNumber:"TFM-999104",placedAt:"2026-10-03T17:50:10Z",cancelledAt:"2026-10-06T00:33:53Z",amountPaise:22500,reason:"Customer asked to cancel after a very long wait for delivery",by:"Isolated OWNER",role:"OWNER"}],
    cash:[{day:from_day,staff:"Isolated ADMIN",collections:2,receivedPaise:85000,refundedPaise:0},{day:from_day,staff:"Isolated EMPLOYEE",collections:1,receivedPaise:42000,refundedPaise:2000}]});
  }
  // Mirrors api.admin_dashboard: EMPLOYEE gets counts and slots only, never money.
  if(url.endsWith("/admin_dashboard")){
   const counts={needsAction:{PLACED:3,CONFIRMED:1,PREPARING:2,READY:0,OUT_FOR_DELIVERY:1},slots:[{slot:"MORNING",delivery:4,pickup:1,open:2},{slot:"AFTERNOON",delivery:2,pickup:0,open:2},{slot:"EVENING",delivery:0,pickup:0,open:0}]};
   if(role==="EMPLOYEE")return Response.json(counts);
   const totals=(n,k)=>({orders:n,revenuePaise:n*k,averagePaise:k,collectedPaise:Math.round(n*k*.6),cashCollectedPaise:Math.round(n*k*.4),pendingPaise:Math.round(n*k*.4)});
   return Response.json({...counts,summary:{current:totals(9,86500),previous:totals(7,91000)},lowStock:[{name:"Seer Fish",onHand:0,measure:"GRAMS",pricingBasis:"RAW_WEIGHT"},{name:"Free Range Brown Eggs",onHand:1,measure:"PACKS",pricingBasis:"TRAY"},{name:"White Prawns",onHand:1500,measure:"GRAMS",pricingBasis:"RAW_WEIGHT"}],topProducts:[{name:"Free Range Brown Eggs",orders:3,revenuePaise:135000},{name:"Mutton Curry Cut",orders:1,revenuePaise:100000},{name:"Sea Prawns Big",orders:1,revenuePaise:80000},{name:"Seabass / Pandugappa",orders:1,revenuePaise:80000},{name:"Bombay Duck",orders:1,revenuePaise:40000}],recentOrders:fixtureOrders.map(o=>({id:o.id,order_number:o.order_number,status:o.status,fulfillment_method:o.fulfillment_method,total_paise:o.total_paise,created_at:o.created_at,customer:o.fulfillment_snapshot.name}))});
  }
  if(url.endsWith("/order_detail")){const order=fixtureOrders.find(o=>o.id===JSON.parse(options.body).target_order);return Response.json({order,items:[{id:order.id+'-1',raw_weight_grams:1000,line_total_paise:order.total_paise,instructions:'',product_snapshot:{productName:'Seer Fish',preparationName:'Curry cut'}}],payments:[]});}
  if(url.endsWith("/catalogue_master"))return Response.json({categories:[],products:[]});
  if(url.endsWith("/business_policy"))return Response.json(null);
  if(url.endsWith("/store_operations"))return Response.json({name:"Isolated test store",delivery:false,pickup:false,hours:{}});
  if(url.endsWith("/operations_report"))return Response.json({intake:{count:0,paise:0},fulfillment:{fulfilledPaise:0,cancelled:0},collections:[],balances:[],products:[],activity:[]});
  return Response.json([]);
 }
 return original(input,options);
};
