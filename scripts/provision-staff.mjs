// Operator-only bootstrap. Never import this script into the application.
import postgres from "postgres";
const {TRAIT_PROVISION_DATABASE_URL,TRAIT_STAFF_AUTH_USER_ID,TRAIT_STAFF_BUSINESS_ID,TRAIT_STAFF_STORE_ID,TRAIT_STAFF_NAME,TRAIT_STAFF_ROLE}=process.env;
const uuid=/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
if(!TRAIT_PROVISION_DATABASE_URL||![TRAIT_STAFF_AUTH_USER_ID,TRAIT_STAFF_BUSINESS_ID,TRAIT_STAFF_STORE_ID].every(x=>uuid.test(x??""))||!TRAIT_STAFF_NAME||!["ADMIN","OWNER","EMPLOYEE"].includes(TRAIT_STAFF_ROLE))throw new Error("Supply operator connection and explicitly approved Auth identity, business, store, name and role.");
const sql=postgres(TRAIT_PROVISION_DATABASE_URL,{ssl:{rejectUnauthorized:true},max:1,prepare:false});
try{
 await sql.begin(async tx=>{
  const users=await tx`select id from auth.users where id=${TRAIT_STAFF_AUTH_USER_ID}::uuid`;
  if(!users.length)throw new Error("Create the real identity in Supabase Auth first.");
  const stores=await tx`select id from app.stores where id=${TRAIT_STAFF_STORE_ID}::uuid and business_id=${TRAIT_STAFF_BUSINESS_ID}::uuid and is_active and deleted_at is null`;
  if(!stores.length)throw new Error("Store does not belong to the approved business.");
  const rows=await tx`insert into app.staff_profiles(business_id,auth_user_id,display_name,role) values(${TRAIT_STAFF_BUSINESS_ID}::uuid,${TRAIT_STAFF_AUTH_USER_ID}::uuid,${TRAIT_STAFF_NAME},${TRAIT_STAFF_ROLE==="ADMIN"?"OWNER":TRAIT_STAFF_ROLE}) returning id`;
  const id=rows[0].id;
  await tx`insert into app.staff_store_assignments(business_id,staff_profile_id,store_id) values(${TRAIT_STAFF_BUSINESS_ID}::uuid,${id}::uuid,${TRAIT_STAFF_STORE_ID}::uuid)`;
  if(TRAIT_STAFF_ROLE==="ADMIN")await tx`insert into app.staff_admin_grants(staff_profile_id) values(${id}::uuid)`;
  await tx`insert into app.staff_access_audit(business_id,actor_id,action,target_id,detail) values(${TRAIT_STAFF_BUSINESS_ID}::uuid,${id}::uuid,'OPERATOR_BOOTSTRAP',${id}::uuid,${JSON.stringify({role:TRAIT_STAFF_ROLE})}::jsonb)`;
 });
 console.log("Approved staff identity provisioned. Credentials remain managed by Supabase Auth.");
}finally{await sql.end();}
