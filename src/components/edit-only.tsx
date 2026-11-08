import type { ReactNode } from "react";
import { can } from "@/lib/auth";

/** Shows its content only to users whose role has the permission (create forms, delete buttons and the like). */
export async function Can({ perm, children }: { perm: string; children: ReactNode }) {
  return (await can(perm)) ? <>{children}</> : null;
}
