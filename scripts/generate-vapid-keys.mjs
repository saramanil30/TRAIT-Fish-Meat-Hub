// Prints a new VAPID key pair for free browser push ("Notify me when available"). Put the lines in deployment secrets.
// Keep the private key secret; changing keys invalidates existing browser subscriptions.
import { createECDH } from "node:crypto";
const ecdh = createECDH("prime256v1"); ecdh.generateKeys();
console.log("NEXT_PUBLIC_TRAIT_WEB_PUSH_PUBLIC_KEY=" + ecdh.getPublicKey().toString("base64url"));
console.log("TRAIT_WEB_PUSH_PRIVATE_KEY=" + Buffer.concat([Buffer.alloc(32), ecdh.getPrivateKey()]).subarray(-32).toString("base64url"));
console.log("TRAIT_WEB_PUSH_SUBJECT=mailto:you@example.com");
