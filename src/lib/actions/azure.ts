"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { type ActionState, toActionError } from "@/lib/action-state";
import { AdoError } from "@/lib/ado-client";
import { checkLobSync, runLobSync } from "@/lib/ado-sync-run";
import { UserError } from "@/lib/sprint-ops";

function fail(err: unknown): ActionState {
  if (err instanceof UserError || err instanceof AdoError) return { error: err.message };
  return toActionError(err);
}

/** Choose which Azure DevOps project a line of business syncs with ("" = not linked). */
export async function linkLobProject(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAuth();
  try {
    const d = z.object({ lobId: z.string().min(1), project: z.string().trim().max(200) }).parse(Object.fromEntries(formData.entries()));
    const current = await db.lineOfBusiness.findUnique({ where: { id: d.lobId }, select: { adoProject: true } });
    if (!current) return { error: "This line of business no longer exists." };
    const project = d.project || null;
    if (project !== current.adoProject) {
      // Links to the old project would point at the wrong items.
      const linked = await db.workItem.count({ where: { lobId: d.lobId, adoId: { not: null } } });
      if (linked > 0) return { error: `This line already has ${linked} item(s) linked to "${current.adoProject}". The project cannot be changed.` };
      await db.lineOfBusiness.update({ where: { id: d.lobId }, data: { adoProject: project, adoLastResult: Prisma.DbNull, adoLastSyncAt: null } });
    }
  } catch (err) {
    return fail(err);
  }
  revalidatePath("/azure");
  return { ok: true, message: "Saved." };
}

/** "check" only reports what would change; "sync" does it. */
export async function syncLob(lobId: string, mode: "check" | "sync", includeOld: boolean): Promise<ActionState> {
  await requireAuth();
  try {
    if (mode === "check") return { ok: true, sync: await checkLobSync(lobId, includeOld) };
    const sync = await runLobSync(lobId, includeOld);
    revalidatePath("/", "layout");
    return { ok: true, sync };
  } catch (err) {
    return fail(err);
  }
}
