import { createHash, randomBytes, randomUUID } from "node:crypto";

/**
 * Trusted Node server utility. Never bundle into client code.
 * Persist this envelope securely for retries; never log its raw tracking token.
 * Store only trackingDigest in PostgreSQL. Expiry is explicit launch policy.
 */
export function createCheckoutEnvelope(expiresAt) {
  const expiry = new Date(expiresAt);
  if (expiresAt == null || !Number.isFinite(expiry.getTime()) || expiry.getTime() <= Date.now()) {
    throw new Error("A future tracking expiry is required.");
  }
  const trackingToken = randomBytes(32).toString("hex");
  return {
    requestId: randomUUID(),
    trackingToken,
    trackingDigest: createHash("sha256").update(trackingToken, "utf8").digest("hex"),
    trackingExpiresAt: expiry.toISOString(),
  };
}
