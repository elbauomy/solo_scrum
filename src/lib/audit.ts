import "server-only";
import { headers } from "next/headers";
import { db, type Tx } from "./db";
import { buildAuditEntry, clientIp, type AuditInput } from "./audit-entry";

/**
 * Records one audit entry. Pass the transaction client when the action already runs in one, so both are saved
 * together. Outside a transaction a failure to write the entry never stops the user's action: it goes to the
 * server log instead.
 */
export async function recordAudit(input: Omit<AuditInput, "ip">, tx?: Tx): Promise<void> {
  let ip: string | null = null;
  try {
    const h = await headers();
    ip = clientIp((name) => h.get(name));
  } catch {
    // Not inside a request (for example a scheduled job): no address.
  }
  const row = buildAuditEntry({ ...input, ip });
  if (tx) {
    await tx.auditLog.create({ data: row });
    return;
  }
  try {
    await db.auditLog.create({ data: row });
  } catch (err) {
    console.error("Could not write the audit entry", input.action, err);
  }
}
