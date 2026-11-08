"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { type ActionState, formObject, optionalInt, optionalText, requiredName, toActionError } from "@/lib/action-state";

const squadSchema = z.object({
  name: requiredName,
  description: optionalText,
  sprintLengthDays: optionalInt,
});

export async function createSquad(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("squads.manage");
  try {
    await db.squad.create({ data: squadSchema.parse(formObject(formData)) });
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function updateSquad(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("squads.manage");
  try {
    const id = String(formData.get("id"));
    await db.squad.update({ where: { id }, data: squadSchema.parse(formObject(formData)) });
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath("/", "layout");
  redirect("/squads");
}

export async function deleteSquad(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("squads.manage");
  const id = String(formData.get("id"));
  try {
    const squad = await db.squad.findUnique({
      where: { id },
      include: { _count: { select: { lobs: true, memberships: true } } },
    });
    if (!squad) return { error: "This squad no longer exists." };
    if (squad._count.lobs > 0 || squad._count.memberships > 0) {
      return {
        error: `Cannot delete: this squad still has ${squad._count.lobs} line(s) of business and ${squad._count.memberships} member(s). Move or delete them first.`,
      };
    }
    await db.squad.delete({ where: { id } });
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath("/", "layout");
  redirect("/squads");
}
