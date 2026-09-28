import {readFileSync} from "node:fs";
import postgres from "postgres";
import {validateInitialStore,provisionInitialStore} from "./initial-store-data.mjs";
const file=process.argv[2];if(!file)throw new Error("Pass an approved JSON file. Default is validation only; --apply writes atomically.");
const data=JSON.parse(readFileSync(file,"utf8"));validateInitialStore(data);
if(!process.argv.includes("--apply")){console.log("Approved-data structure valid. No database contacted.");}else{
 if(!process.env.TRAIT_PROVISION_DATABASE_URL)throw new Error("Set the operator-only provisioning connection securely.");
 const sql=postgres(process.env.TRAIT_PROVISION_DATABASE_URL,{ssl:{rejectUnauthorized:true},max:1,prepare:false});
 try{console.log(JSON.stringify(await provisionInitialStore(sql,data)));}finally{await sql.end();}
}
