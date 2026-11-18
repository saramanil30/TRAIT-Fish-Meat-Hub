import "server-only";
import { createCipheriv, createECDH, createHmac, createPrivateKey, randomBytes, sign, type KeyObject } from "node:crypto";

/** Free browser push (Web Push, RFC 8030/8291/8292) with no third-party service: VAPID-signed, aes128gcm-encrypted.
 *  Keys: `node scripts/generate-vapid-keys.mjs`. Endpoints are accepted only on the major browsers' push services. */
export type PushTarget = { endpoint: string; p256dh: string; auth: string };
const PUSH_HOSTS = /^([a-z0-9-]+\.)*(fcm\.googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com|push\.apple\.com)$/;

export function validPushEndpoint(endpoint: string) {
 try {
  const url = new URL(endpoint);
  return endpoint.length <= 1000 && url.protocol === "https:" && !url.username && !url.password && !url.port && PUSH_HOSTS.test(url.hostname) && url.pathname.length > 1;
 } catch { return false; }
}
/** A browser PushSubscription's JSON as {endpoint,p256dh,auth}, or null when it is not a usable subscription. */
export function pushTarget(json: string): PushTarget | null {
 if (!json || json.length > 1500) return null;
 try {
  const s = JSON.parse(json);
  const target = { endpoint: s?.endpoint, p256dh: s?.keys?.p256dh, auth: s?.keys?.auth };
  if (typeof target.endpoint !== "string" || !validPushEndpoint(target.endpoint)) return null;
  if (typeof target.p256dh !== "string" || !/^[A-Za-z0-9_-]{86,88}$/.test(target.p256dh)) return null;
  if (typeof target.auth !== "string" || !/^[A-Za-z0-9_-]{22,24}$/.test(target.auth)) return null;
  return target;
 } catch { return null; }
}

let vapidKey: { key: KeyObject; publicKey: string; subject: string } | undefined;
export function pushConfigured() {
 return !!process.env.NEXT_PUBLIC_TRAIT_WEB_PUSH_PUBLIC_KEY && !!process.env.TRAIT_WEB_PUSH_PRIVATE_KEY && !!process.env.TRAIT_WEB_PUSH_SUBJECT;
}
function vapid() {
 if (vapidKey) return vapidKey;
 const publicKey = process.env.NEXT_PUBLIC_TRAIT_WEB_PUSH_PUBLIC_KEY ?? "", d = process.env.TRAIT_WEB_PUSH_PRIVATE_KEY ?? "", subject = process.env.TRAIT_WEB_PUSH_SUBJECT ?? "";
 const point = Buffer.from(publicKey, "base64url");
 if (point.length !== 65 || point[0] !== 4 || Buffer.from(d, "base64url").length !== 32 || !/^(mailto:\S+@\S+|https:\/\/\S+)$/.test(subject)) throw new Error("Browser push is not configured.");
 const key = createPrivateKey({ key: { kty: "EC", crv: "P-256", d, x: point.subarray(1, 33).toString("base64url"), y: point.subarray(33).toString("base64url") }, format: "jwk" });
 return vapidKey = { key, publicKey, subject };
}
const hmac = (key: Buffer, data: Buffer) => createHmac("sha256", key).update(data).digest();

/** RFC 8291 aes128gcm body for one subscription (single record). `salt`/`senderKey` are for test vectors only. */
export function encryptPush(target: Pick<PushTarget, "p256dh" | "auth">, plaintext: Buffer, test?: { salt: Buffer; senderPrivateKey: Buffer }) {
 const receiver = Buffer.from(target.p256dh, "base64url"), secret = Buffer.from(target.auth, "base64url");
 if (receiver.length !== 65 || receiver[0] !== 4 || secret.length !== 16) throw new Error("Invalid push subscription.");
 if (plaintext.length > 3800) throw new Error("Push message is too long.");
 const ecdh = createECDH("prime256v1");
 if (test) ecdh.setPrivateKey(test.senderPrivateKey); else ecdh.generateKeys();
 const sender = ecdh.getPublicKey();
 const ikm = hmac(hmac(secret, ecdh.computeSecret(receiver)), Buffer.concat([Buffer.from("WebPush: info\0"), receiver, sender, Buffer.from([1])]));
 const salt = test?.salt ?? randomBytes(16), prk = hmac(salt, ikm);
 const cek = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01")).subarray(0, 16);
 const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01")).subarray(0, 12);
 const cipher = createCipheriv("aes-128-gcm", cek, nonce);
 const body = Buffer.concat([cipher.update(Buffer.concat([plaintext, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
 const header = Buffer.alloc(21); salt.copy(header); header.writeUInt32BE(4096, 16); header[20] = sender.length;
 return Buffer.concat([header, sender, body]);
}

/** Sends one push; resolves to the push service's HTTP status (201 = accepted; 404/410 = subscription gone). */
export async function sendPush(target: PushTarget, message: { title: string; body: string; url: string; tag?: string }) {
 if (!validPushEndpoint(target.endpoint)) throw new Error("Push endpoint not allowed.");
 const { key, publicKey, subject } = vapid();
 const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
 const unsigned = b64({ typ: "JWT", alg: "ES256" }) + "." + b64({ aud: new URL(target.endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject });
 const jwt = unsigned + "." + sign("sha256", Buffer.from(unsigned), { key, dsaEncoding: "ieee-p1363" }).toString("base64url");
 const response = await fetch(target.endpoint, {
  method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10000),
  headers: { Authorization: "vapid t=" + jwt + ", k=" + publicKey, TTL: String(3 * 86400), Urgency: "normal", "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream" },
  body: new Uint8Array(encryptPush(target, Buffer.from(JSON.stringify(message)))),
 });
 return response.status;
}
