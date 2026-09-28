import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const {PGlite}=await import("../../node_modules/.staff-validation/node_modules/@electric-sql/pglite/dist/index.js");
process.on("uncaughtException",e=>{console.error(e.message,e.code??"",e.where??"",e.hint??"");process.exit(1);});
const db=new PGlite();
await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY); CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; CREATE ROLE migration_test NOSUPERUSER CREATEROLE CREATEDB BYPASSRLS; GRANT CREATE ON DATABASE postgres TO migration_test; GRANT USAGE ON SCHEMA auth TO migration_test; GRANT REFERENCES ON auth.users TO migration_test; SET ROLE migration_test;");
// PGlite reserves its bootstrap postgres role. Substitute only the expected owner
// identifier in memory; on-disk historical migrations remain byte-for-byte intact.
for(const file of ["20260923041240_phase_5b_1_foundation.sql","20260926000000_staff_access.sql","20260926120000_phase_5b_2_catalogue.sql","20260926140000_phase_5b_3_customers_delivery.sql","20260926200000_core_orders_payments_audit.sql"]){
const source=readFileSync(new URL("../migrations/"+file,import.meta.url),"utf8");
await db.exec(source.replace(/\bpostgres\b/g,"migration_test"));
}
const members=(await db.query("SELECT r.rolname,pg_get_userbyid(m.member) AS member,m.admin_option,m.inherit_option,m.set_option FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid WHERE r.rolname IN ('trait_checkout','trait_payment_verifier') ORDER BY r.rolname")).rows;
assert.equal(members.length,2);
for(const m of members){assert.equal(m.member,"migration_test");assert.equal(m.admin_option,true);assert.equal(m.inherit_option,false);assert.equal(m.set_option,false);}
console.log("PASS all migrations execute under a nonsuperuser CREATEROLE/BYPASSRLS owner; only administrative memberships are created.");
await db.close();
