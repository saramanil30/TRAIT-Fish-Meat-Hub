import "server-only";

/** Server-only access to allowlisted public database projections. */
export async function publicRpc<T>(name: "catalogue" | "storefront_info" | "fulfillment_options" | "track_order", args: Record<string, unknown>): Promise<T> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key || new URL(url).protocol !== "https:") throw new Error("Store connection is not configured.");
  const response = await fetch(new URL("/rest/v1/rpc/" + name, url), {
    method: "POST", cache: "no-store", signal: AbortSignal.timeout(15000),
    headers: { apikey: key, "Content-Type": "application/json", "Content-Profile": "api", "Accept-Profile": "api" },
    body: JSON.stringify(args),
  });
  if (!response.ok) throw new Error("Store service is temporarily unavailable.");
  return response.json() as Promise<T>;
}
