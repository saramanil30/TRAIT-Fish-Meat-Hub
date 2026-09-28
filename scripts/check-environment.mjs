import {existsSync} from "node:fs";
if(existsSync(".env.local"))process.loadEnvFile(".env.local");
const required=["SUPABASE_URL","SUPABASE_PUBLISHABLE_KEY","TRAIT_STORE_ID","TRAIT_CHECKOUT_DATABASE_URL","TRAIT_CHECKOUT_ENVELOPE_KEY","TRAIT_TRACKING_EXPIRY_DAYS","TRAIT_RATE_LIMIT_REST_URL","TRAIT_RATE_LIMIT_REST_TOKEN","SUPABASE_AUTH_ADMIN_KEY","TRAIT_AUTH_RECOVERY_URL"];
const missing=required.filter(k=>!process.env[k]);
const invalid=[];
for(const k of ["SUPABASE_URL","TRAIT_RATE_LIMIT_REST_URL","TRAIT_AUTH_RECOVERY_URL"]){if(process.env[k])try{if(new URL(process.env[k]).protocol!=="https:")invalid.push(k);}catch{invalid.push(k);}}
if(process.env.TRAIT_CHECKOUT_ENVELOPE_KEY&&!/^[a-f0-9]{64}$/i.test(process.env.TRAIT_CHECKOUT_ENVELOPE_KEY))invalid.push("TRAIT_CHECKOUT_ENVELOPE_KEY");
if(process.env.TRAIT_TRACKING_EXPIRY_DAYS&&(!Number.isInteger(Number(process.env.TRAIT_TRACKING_EXPIRY_DAYS))||Number(process.env.TRAIT_TRACKING_EXPIRY_DAYS)<1||Number(process.env.TRAIT_TRACKING_EXPIRY_DAYS)>365))invalid.push("TRAIT_TRACKING_EXPIRY_DAYS");
if(process.env.TRAIT_STORE_ID&&!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(process.env.TRAIT_STORE_ID))invalid.push("TRAIT_STORE_ID");
if(process.env.TRAIT_STAFF_ENABLED!=="true")missing.push("TRAIT_STAFF_ENABLED=true");
console.log(JSON.stringify({ready:!missing.length&&!invalid.length,missing,invalid,notice:"Values are never printed. Database capability and external-service checks remain required."},null,2));
if(missing.length||invalid.length)process.exitCode=1;
