"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { type ActionState, formObject, optionalInt, optionalText, requiredName, toActionError } from "@/lib/action-state";
import { LOB_KEY_PATTERN, normalizeLobKey } from "@/lib/work-items";

const lobSchema = z.object({
  name: requiredName,
  description: optionalText,
  squadId: z.string().min(1, "Please choose the squad that owns this line of business"),
  sprintLengthDays: optionalInt,
  key: z
    .string()
    .transform(normalizeLobKey)
    .pipe(z.string().regex(LOB_KEY_PATTERN, "Code must be 2-6 letters or digits and start with a letter (e.g. RB)")),
});

function friendly(err: unknown): ActionState {
  const res = toActionError(err);
  if (res.error?.startsWith("That name")) return { error: "That name or code is already used by another line of business." };
  return res;
}

export async function createLob(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("lobs.manage");
  try {
    await db.lineOfBusiness.create({ data: lobSchema.parse(formObject(formData)) });
  } catch (err) {
    return friendly(err);
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function updateLob(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("lobs.manage");
  try {
    const id = String(formData.get("id"));
    const data = lobSchema.parse(formObject(formData));
    const current = await db.lineOfBusiness.findUnique({ where: { id }, select: { squadId: true, _count: { select: { workItems: true } } } });
    if (current && current.squadId !== data.squadId && current._count.workItems > 0) {
      return { error: "This line of business already has work items, so its squad cannot be changed." };
    }
    // Hours reserved for this line belong to its old squad's memberships, so they end when it moves.
    if (current && current.squadId !== data.squadId) await db.memberLobAllocation.deleteMany({ where: { lobId: id } });
    await db.lineOfBusiness.update({ where: { id }, data });
  } catch (err) {
    return friendly(err);
  }
  revalidatePath("/", "layout");
  redirect("/lobs");
}

export async function deleteLob(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("lobs.manage");
  try {
    const id = String(formData.get("id"));
    const items = await db.workItem.count({ where: { lobId: id } });
    if (items > 0) {
      return { error: `Cannot delete: this line of business has ${items} work item(s). Delete them first.` };
    }
    const [sprints, releases] = await Promise.all([db.sprint.count({ where: { lobId: id } }), db.release.count({ where: { lobId: id } })]);
    if (sprints > 0 || releases > 0) {
      return { error: `Cannot delete: this line of business has ${sprints} sprint(s) and ${releases} release(s). Delete them first.` };
    }
    await db.lineOfBusiness.delete({ where: { id } });
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath("/", "layout");
  redirect("/lobs");
}
