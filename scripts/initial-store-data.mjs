export function validateInitialStore(data){
 const b=data?.business,s=data?.store,p=data?.policy;
 const text=(v,max)=>typeof v==="string"&&v.trim()===v&&v.length>0&&v.length<=max;
 const integer=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
 if(!b||!s||!p||!text(b.slug,63)||!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(b.slug)||!text(b.displayName,160)||(b.legalName!==null&&!text(b.legalName,240)))throw new Error("Supply approved business identity.");
 if(!text(s.code,32)||!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s.code)||!text(s.name,160)||!text(s.addressLine1,240)||!text(s.city,120)||!text(s.state,120)||!/^[1-9][0-9]{5}$/.test(s.pincode)||!/^\+91[6-9][0-9]{9}$/.test(s.contactMobile))throw new Error("Supply approved store identity, address, pincode and +91 mobile.");
 if(typeof s.pickupEnabled!=="boolean"||typeof s.deliveryEnabled!=="boolean"||!s.openingHours||Array.isArray(s.openingHours)||typeof s.openingHours!=="object")throw new Error("Supply explicit fulfillment flags and opening hours.");
 try{new Intl.DateTimeFormat("en",{timeZone:s.timezone});}catch{throw new Error("Invalid store timezone.");}
 if(!integer(p.historyDays,1,365)||(p.cashLimitPaise!==null&&!integer(p.cashLimitPaise,1,1e12))||typeof p.requirePaymentBeforeCompletion!=="boolean"||!integer(p.maxOrderItems,1,500)||!integer(p.maxOrderTotalPaise,1,1e12))throw new Error("Supply approved operational policy values.");
 if((data.catalogue??[]).length||(data.staff??[]).length||(data.deliveryAreas??[]).length)throw new Error("Use the authorized staff/catalogue/delivery workflows after bootstrap; this script creates business/store/policy only.");
 return {business:b,store:s,policy:p};
}
export async function provisionInitialStore(sql,data){
 const {business:b,store:s,policy:p}=validateInitialStore(data);
 return sql.begin(async tx=>{
  await tx`select pg_advisory_xact_lock(hashtextextended(${b.slug},0))`;
  const existing=await tx`select id from app.businesses where slug=${b.slug}`;
  if(existing.length)throw new Error("Business already exists; inspect it instead of overwriting or replaying bootstrap.");
  const [business]=await tx`insert into app.businesses(slug,display_name,legal_name) values(${b.slug},${b.displayName},${b.legalName}) returning id`;
  const [store]=await tx`insert into app.stores(business_id,code,name,timezone,address_line1,address_line2,locality,city,state,pincode,contact_mobile_e164,opening_hours,delivery_enabled,pickup_enabled) values(${business.id},${s.code},${s.name},${s.timezone},${s.addressLine1},${s.addressLine2??null},${s.locality??null},${s.city},${s.state},${s.pincode},${s.contactMobile},${JSON.stringify(s.openingHours)}::jsonb,${s.deliveryEnabled},${s.pickupEnabled}) returning id`;
  await tx`insert into app.business_settings(business_id,employee_operational_history_days,employee_cash_collection_limit_paise,require_payment_before_completion,max_order_items,max_order_total_paise) values(${business.id},${p.historyDays},${p.cashLimitPaise},${p.requirePaymentBeforeCompletion},${p.maxOrderItems},${p.maxOrderTotalPaise})`;
  await tx`select app.core_audit(${business.id}::uuid,${store.id}::uuid,null,'SYSTEM','OPERATOR_STORE_BOOTSTRAP',${store.id}::uuid,'{}'::jsonb)`;
  return {businessId:business.id,storeId:store.id};
 });
}
