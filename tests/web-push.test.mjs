import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createDecipheriv,createECDH,createHmac} from "node:crypto";
import ts from "typescript";
const source=readFileSync(new URL("../src/lib/web-push.ts",import.meta.url),"utf8").replace('import "server-only";',"");
const {encryptPush,pushTarget,validPushEndpoint}=await import("data:text/javascript;base64,"+Buffer.from(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText).toString("base64"));
const b=s=>Buffer.from(s,"base64url");

test("aes128gcm matches the RFC 8291 Appendix A test vector",()=>{
 const body=encryptPush({p256dh:"BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",auth:"BTBZMqHH6r4Tts7J_aSIgg"},
  Buffer.from("When I grow up, I want to be a watermelon"),{salt:b("DGv6ra1nlYgDCS1FRnbzlw"),senderPrivateKey:b("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw")});
 assert.equal(body.toString("base64url"),"DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN");
});

test("a browser can decrypt a random-key push",()=>{
 const browser=createECDH("prime256v1");browser.generateKeys();
 const auth=Buffer.alloc(16,7),message=Buffer.from(JSON.stringify({title:"Rohu is back at TRAIT!"}));
 const body=encryptPush({p256dh:browser.getPublicKey().toString("base64url"),auth:auth.toString("base64url")},message);
 const salt=body.subarray(0,16),sender=body.subarray(21,86),h=(k,d)=>createHmac("sha256",k).update(d).digest();
 const ikm=h(h(auth,browser.computeSecret(sender)),Buffer.concat([Buffer.from("WebPush: info\0"),browser.getPublicKey(),sender,Buffer.from([1])]));
 const prk=h(salt,ikm),d=createDecipheriv("aes-128-gcm",h(prk,Buffer.from("Content-Encoding: aes128gcm\0\x01")).subarray(0,16),h(prk,Buffer.from("Content-Encoding: nonce\0\x01")).subarray(0,12));
 const data=body.subarray(86);d.setAuthTag(data.subarray(-16));
 const plain=Buffer.concat([d.update(data.subarray(0,-16)),d.final()]);
 assert.deepEqual(plain,Buffer.concat([message,Buffer.from([2])]));
});

test("only real push-service endpoints and well-formed subscriptions are accepted",()=>{
 for(const ok of ["https://fcm.googleapis.com/fcm/send/x","https://updates.push.services.mozilla.com/wpush/v2/x","https://wns2-pn1p.notify.windows.com/w/?token=x","https://web.push.apple.com/x"])assert.equal(validPushEndpoint(ok),true,ok);
 for(const bad of ["http://fcm.googleapis.com/x","https://fcm.googleapis.com.evil.com/x","https://evilfcm.googleapis.com.example/x","https://user@fcm.googleapis.com/x","https://fcm.googleapis.com:8443/x","https://localhost/x","https://169.254.169.254/x","https://fcm.googleapis.com/"])assert.equal(validPushEndpoint(bad),false,bad);
 const keys={p256dh:"B"+"A".repeat(86),auth:"A".repeat(22)};
 assert.deepEqual(pushTarget(JSON.stringify({endpoint:"https://fcm.googleapis.com/fcm/send/x",expirationTime:null,keys})),{endpoint:"https://fcm.googleapis.com/fcm/send/x",...keys});
 for(const bad of ["","not json",JSON.stringify({endpoint:"https://evil.example/x",keys}),JSON.stringify({endpoint:"https://fcm.googleapis.com/x",keys:{...keys,auth:"short"}})])assert.equal(pushTarget(bad),null);
});
