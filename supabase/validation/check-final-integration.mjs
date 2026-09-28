import {readFileSync} from "node:fs";
const root=new URL("./",import.meta.url);
let source=readFileSync(new URL("check-core-backend.mjs",root),"utf8");
for(const path of ["../../node_modules/.staff-validation/node_modules/@electric-sql/pglite/dist/index.js","../runtime/checkout-envelope.mjs"])source=source.replace(JSON.stringify(path),JSON.stringify(new URL(path,root).href));
source=source.replace('new URL("./",import.meta.url)','new URL('+JSON.stringify(root.href)+')');
source=source.replace('await db.close();','await (await import('+JSON.stringify(new URL("final-integration-checks.mjs",root).href)+')).validate({db,as,value,q,id,denied,payload}); await db.close();');
await import("data:text/javascript;base64,"+Buffer.from(source).toString("base64"));
