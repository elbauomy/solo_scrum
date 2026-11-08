"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { parseDate } from "@/lib/dates";
import { type ActionState, isoDate, optionalText, requiredName, toActionError } from "@/lib/action-state";

const memberSchema = z.object({
  name: requiredName,
  role: z.string().trim().max(100, "Role is too long").default(""),
});

const weeklyHours = z.coerce
  .number({ message: "Hours per week must be a number" })
  .min(0, "Hours per week cannot be negative")
  .max(168, "Hours per week cannot exceed 168");

export async function createMember(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("members.manage");
  try {
    const data = memberSchema.parse({ name: formData.get("name"), role: formData.get("role") ?? "" });
    const squadId = String(formData.get("squadId") ?? "");
    const hours = squadId ? weeklyHours.parse(formData.get("weeklyHours")) : null;
    await db.member.create({
      data: {
        ...data,
        memberships: squadId ? { create: { squadId, weeklyHours: hours! } } : undefined,
      },
    });
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function updateMember(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("members.manage");
  try {
    const id = String(formData.get("id"));
    const data = memberSchema.parse({ name: formData.get("name"), role: formData.get("role") ?? "" });
    await db.member.update({ where: { id }, data: { ...data, active: formData.get("active") === "on" } });
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteMember(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("members.manage");
  try {
    await db.member.delete({ where: { id: String(formData.get("id")) } });
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath("/", "layout");
  redirect("/members");
}

export async function saveMembership(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("members.manage");
  try {
    const memberId = String(formData.get("memberId"));
    const squadId = z.string().min(1, "Please choose a squad").parse(formData.get("squadId"));
    const hours = weeklyHours.parse(formData.get("weeklyHours"));
    const existing = await db.squadMembership.findUnique({ where: { memberId_squadId: { memberId, squadId } }, include: { lobAllocations: true } });
    const reserved = existing?.lobAllocations.reduce((sum, a) => sum + a.weeklyHours, 0) ?? 0;
    if (hours + 1e-9 < reserved) {
      return { error: `${reserved} h/week are already reserved for lines of business in this squad. Reduce those hours first, or enter at least ${reserved}.` };
    }
    await db.squadMembership.upsert({
      where: { memberId_squadId: { memberId, squadId } },
      update: { weeklyHours: hours },
      create: { memberId, squadId, weeklyHours: hours },
    });
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function removeMembership(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("members.manage");
  try {
    await db.squadMembership.delete({ where: { id: String(formData.get("id")) } });
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

const leaveSchema = z
  .object({ startDate: isoDate, endDate: isoDate, note: optionalText })
  .refine((v) => v.startDate <= v.endDate, { message: "End date must be on or after the start date" });

export async function addLeave(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("members.manage");
  try {
    const memberId = String(formData.get("memberId"));
    const data = leaveSchema.parse({
      startDate: formData.get("startDate"),
      endDate: formData.get("endDate"),
      note: formData.get("note") ?? "",
    });
    await db.leave.create({
      data: { memberId, startDate: parseDate(data.startDate), endDate: parseDate(data.endDate), note: data.note },
    });
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function deleteLeave(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("members.manage");
  try {
    await db.leave.delete({ where: { id: String(formData.get("id")) } });
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Reserve hours per week for lines of business inside one squad membership.
 * Fields are named `hours_<lobId>`; empty or 0 removes the reservation. Whatever is left stays shared by the squad's lines.
 */
export async function saveLobAllocations(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("members.manage");
  try {
    const membershipId = String(formData.get("membershipId"));
    const membership = await db.squadMembership.findUnique({ where: { id: membershipId }, include: { squad: { include: { lobs: { select: { id: true } } } } } });
    if (!membership) return { error: "This squad membership no longer exists." };
    const wanted: { lobId: string; hours: number }[] = [];
    for (const lob of membership.squad.lobs) {
      const raw = formData.get(`hours_${lob.id}`);
      if (raw == null || String(raw).trim() === "") continue;
      const hours = weeklyHours.parse(raw);
      if (hours > 0) wanted.push({ lobId: lob.id, hours });
    }
    const total = wanted.reduce((sum, w) => sum + w.hours, 0);
    if (total > membership.weeklyHours + 1e-9) {
      return { error: `The lines add up to ${total} h/week, but the member has ${membership.weeklyHours} h/week in ${membership.squad.name}. Lower the hours or raise the squad hours first.` };
    }
    await db.$transaction([
      db.memberLobAllocation.deleteMany({ where: { membershipId, lobId: { notIn: wanted.map((w) => w.lobId) } } }),
      ...wanted.map((w) =>
        db.memberLobAllocation.upsert({
          where: { membershipId_lobId: { membershipId, lobId: w.lobId } },
          update: { weeklyHours: w.hours },
          create: { membershipId, lobId: w.lobId, weeklyHours: w.hours },
        }),
      ),
    ]);
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Delete the selected members. Their tasks become unassigned; their squad hours, leave, sprint capacity and standup notes are removed with them. */
export async function deleteMembers(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("members.manage");
  try {
    const ids = formData.getAll("id").map(String).filter(Boolean);
    if (ids.length === 0) return { error: "Tick at least one member first." };
    const found = await db.member.findMany({ where: { id: { in: ids } }, select: { id: true } });
    await db.member.deleteMany({ where: { id: { in: found.map((m) => m.id) } } });
    revalidatePath("/", "layout");
    return { ok: true, message: `Deleted ${found.length} member${found.length === 1 ? "" : "s"}.` };
  } catch (err) {
    return toActionError(err);
  }
}
