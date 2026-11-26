"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { parseDate, toISODate } from "@/lib/dates";
import { UserError } from "@/lib/sprint-ops";
import { type ActionState, isoDate, optionalText, toActionError } from "@/lib/action-state";

function fail(err: unknown): ActionState {
  if (err instanceof UserError) return { error: err.message };
  return toActionError(err);
}
const refresh = () => revalidatePath("/", "layout");

const releaseSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100, "Name is too long"),
  version: z.string().trim().max(50, "Version is too long").default(""),
  notes: optionalText,
  targetDate: isoDate,
});

export async function createRelease(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("releases.manage");
  let id = "";
  try {
    const lobId = z.string().min(1, "Please choose a line of business").parse(formData.get("lobId"));
    const d = releaseSchema.parse(Object.fromEntries(formData.entries()));
    const r = await db.release.create({ data: { lobId, name: d.name, version: d.version, notes: d.notes, targetDate: parseDate(d.targetDate) } });
    id = r.id;
  } catch (err) {
    return fail(err);
  }
  refresh();
  redirect(`/releases/${id}`);
}

/** Edits a release. If the target date changes, the old and new dates are logged with the reason. */
export async function updateRelease(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("releases.manage");
  try {
    const id = String(formData.get("id"));
    const d = releaseSchema.parse(Object.fromEntries(formData.entries()));
    const reason = z.string().trim().max(500, "Reason is too long").default("").parse(formData.get("reason") ?? "");
    await db.$transaction(async (tx) => {
      const current = await tx.release.findUnique({ where: { id } });
      if (!current) throw new UserError("This release no longer exists.");
      const newDate = parseDate(d.targetDate);
      if (toISODate(current.targetDate) !== d.targetDate) {
        await tx.releaseDateChange.create({ data: { releaseId: id, oldDate: current.targetDate, newDate, reason } });
      }
      await tx.release.update({ where: { id }, data: { name: d.name, version: d.version, notes: d.notes, targetDate: newDate } });
    });
  } catch (err) {
    return fail(err);
  }
  refresh();
  return { ok: true };
}

/** Record the real deployment date (empty clears it). */
export async function setDeployed(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("releases.manage");
  try {
    const id = String(formData.get("id"));
    const raw = String(formData.get("deployedDate") ?? "");
    await db.release.update({ where: { id }, data: { deployedDate: raw ? parseDate(isoDate.parse(raw)) : null } });
  } catch (err) {
    return fail(err);
  }
  refresh();
  return { ok: true };
}

export async function deleteRelease(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("releases.manage");
  try {
    await db.release.delete({ where: { id: String(formData.get("id")) } });
  } catch (err) {
    return fail(err);
  }
  refresh();
  redirect("/releases");
}

/** Put a sprint into a release (or remove it with releaseId = null). */
export async function setSprintRelease(sprintId: string, releaseId: string | null): Promise<ActionState> {
  await requirePermission("releases.manage", "sprints.manage");
  try {
    const sprint = await db.sprint.findUnique({ where: { id: sprintId } });
    if (!sprint) return { error: "This sprint no longer exists." };
    if (releaseId) {
      const r = await db.release.findUnique({ where: { id: releaseId } });
      if (!r || r.lobId !== sprint.lobId) return { error: "A sprint can only join a release of its own line of business." };
    }
    await db.sprint.update({ where: { id: sprintId }, data: { releaseId } });
  } catch (err) {
    return fail(err);
  }
  refresh();
  return { ok: true };
}
