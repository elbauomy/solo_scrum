"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { parseDate } from "@/lib/dates";
import { type ActionState, isoDate, requiredName, toActionError } from "@/lib/action-state";

const settingsSchema = z.object({
  workingDays: z.array(z.coerce.number().int().min(0).max(6)).min(1, "Pick at least one working day"),
  defaultDailyHours: z.coerce.number().positive("Hours per day must be more than 0").max(24, "Hours per day cannot exceed 24"),
  defaultSprintLengthDays: z.coerce.number().int("Sprint length must be a whole number").min(1).max(365),
});

export async function updateSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("settings.manage");
  try {
    const data = settingsSchema.parse({
      workingDays: formData.getAll("workingDays"),
      defaultDailyHours: formData.get("defaultDailyHours"),
      defaultSprintLengthDays: formData.get("defaultSprintLengthDays"),
    });
    data.workingDays = [...new Set(data.workingDays)].sort();
    await db.setting.upsert({ where: { id: 1 }, update: data, create: { id: 1, ...data } });
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

const holidaySchema = z.object({ date: isoDate, name: requiredName });

export async function addHoliday(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("settings.manage");
  try {
    const data = holidaySchema.parse({ date: formData.get("date"), name: formData.get("name") });
    await db.holiday.create({ data: { date: parseDate(data.date), name: data.name } });
  } catch (err) {
    const res = toActionError(err);
    if (res.error?.startsWith("That name")) return { error: "There is already a holiday on that date." };
    return res;
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteHoliday(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("settings.manage");
  try {
    await db.holiday.delete({ where: { id: String(formData.get("id")) } });
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath("/", "layout");
  return { ok: true };
}
