"use server";
import { revalidatePath } from "next/cache";
import { requireStaff, staffRpc } from "@/lib/admin/server";

/** ADMIN/OWNER (Prices & Availability): mark a back-in-stock request notified after sending its WhatsApp message. */
export async function markRestockNotified(requestId: string): Promise<{ error?: string; notifiedAt?: string }> {
 try {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) throw new Error("Invalid record.");
  const { token, context } = await requireStaff("prices");
  if (context.role !== "ADMIN" && context.role !== "OWNER") throw new Error("Access denied.");
  const result = await staffRpc<{ notifiedAt: string }>(token, "mark_restock_notified", { target_request: requestId });
  revalidatePath("/admin", "layout");
  return { notifiedAt: result.notifiedAt };
 } catch (error) { return { error: error instanceof Error ? error.message : "Could not mark notified." }; }
}
