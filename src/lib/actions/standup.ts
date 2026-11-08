"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { parseDate } from "@/lib/dates";
import { isStandupLeave, offNote } from "@/lib/standup";
import { type ActionState, isoDate, toActionError } from "@/lib/action-state";

const text = z.string().max(4000, "Text is too long (4000 characters at most)").default("");
const schema = z.object({
  date: isoDate,
  squadId: z.string().min(1),
  memberId: z.string().min(1),
  status: text,
  blockers: text,
  off: z.preprocess((v) => v === "on", z.boolean()),
  offReason: z.string().trim().max(200, "The reason is too long (200 characters at most)").default(""),
});

/**
 * Save one member's status for one day.
 * Marking the member "off" records it, clears the status, and adds a one-day leave so capacity and the timeline plan around that day.
 * Unmarking removes the leave that the standup added. A day with no status, no blockers and not off removes the note.
 */
export async function saveStandup(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("standup.edit");
  try {
    const d = schema.parse(Object.fromEntries(formData.entries()));
    const date = parseDate(d.date);
    const status = d.off ? "" : d.status;
    const blockers = d.off ? "" : d.blockers;
    const offReason = d.off ? d.offReason : "";
    await db.$transaction(async (tx) => {
      const empty = !d.off && !status.trim() && !blockers.trim();
      if (empty) {
        await tx.standupEntry.deleteMany({ where: { date, squadId: d.squadId, memberId: d.memberId } });
      } else {
        // Notes saved in the earlier format (yesterday / today) are folded into the status the first time they are edited.
        await tx.standupEntry.upsert({
          where: { date_squadId_memberId: { date, squadId: d.squadId, memberId: d.memberId } },
          update: { status, blockers, off: d.off, offReason, yesterday: "", today: "" },
          create: { date, squadId: d.squadId, memberId: d.memberId, status, blockers, off: d.off, offReason },
        });
      }
      // A person is off for every squad they are in, so the other squads' notes for that day follow.
      await tx.standupEntry.updateMany({ where: { date, memberId: d.memberId, squadId: { not: d.squadId } }, data: { off: d.off, offReason } });

      const sameDay = await tx.leave.findMany({ where: { memberId: d.memberId, startDate: { lte: date }, endDate: { gte: date } } });
      const ours = sameDay.filter((l) => l.startDate.getTime() === date.getTime() && l.endDate.getTime() === date.getTime() && isStandupLeave(l.note));
      if (d.off) {
        const covered = sameDay.some((l) => !ours.includes(l));
        if (ours.length > 0) {
          await tx.leave.update({ where: { id: ours[0].id }, data: { note: offNote(offReason) } });
        } else if (!covered) {
          await tx.leave.create({ data: { memberId: d.memberId, startDate: date, endDate: date, note: offNote(offReason) } });
        }
      } else if (ours.length > 0) {
        await tx.leave.deleteMany({ where: { id: { in: ours.map((l) => l.id) } } });
      }
    });
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath("/", "layout");
  return { ok: true };
}
