"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { addDays, parseDate, toISODate, todayUTC } from "@/lib/dates";
import { addWorkingDays, workingDaysBetween } from "@/lib/capacity";
import { getWorkCalendar } from "@/lib/settings";
import { loadAnalytics } from "@/lib/analytics";
import { moveItemToSprint, UserError } from "@/lib/sprint-ops";
import { type ActionState, isoDate, optionalText, toActionError } from "@/lib/action-state";

function fail(err: unknown): ActionState {
  if (err instanceof UserError) return { error: err.message };
  return toActionError(err);
}
const refresh = () => revalidatePath("/", "layout");

const optionalId = z.preprocess((v) => (v === "" || v == null ? null : String(v)), z.string().nullable());

const sprintSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(100, "Name is too long"),
    goal: optionalText,
    startDate: isoDate,
    endDate: isoDate,
    releaseId: optionalId,
  })
  .refine((v) => v.startDate <= v.endDate, { message: "The end date must be on or after the start date" });

async function checkRelease(lobId: string, releaseId: string | null) {
  if (!releaseId) return;
  const r = await db.release.findUnique({ where: { id: releaseId }, select: { lobId: true } });
  if (!r) throw new UserError("The chosen release no longer exists.");
  if (r.lobId !== lobId) throw new UserError("A sprint can only join a release of its own line of business.");
}

export async function createSprint(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("sprints.manage");
  let id = "";
  try {
    const lobId = z.string().min(1, "Please choose a line of business").parse(formData.get("lobId"));
    const data = sprintSchema.parse(Object.fromEntries(formData.entries()));
    await checkRelease(lobId, data.releaseId);
    const sprint = await db.sprint.create({
      data: { lobId, name: data.name, goal: data.goal, startDate: parseDate(data.startDate), endDate: parseDate(data.endDate), releaseId: data.releaseId },
    });
    id = sprint.id;
  } catch (err) {
    return fail(err);
  }
  refresh();
  redirect(`/sprints/${id}`);
}

export async function updateSprint(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("sprints.manage");
  try {
    const id = String(formData.get("id"));
    const data = sprintSchema.parse(Object.fromEntries(formData.entries()));
    const sprint = await db.sprint.findUnique({ where: { id } });
    if (!sprint) return { error: "This sprint no longer exists." };
    await checkRelease(sprint.lobId, data.releaseId);
    // A closed sprint keeps its dates (its results were saved), but its name, goal and release can still be corrected.
    const closed = sprint.state === "CLOSED";
    const nameGoalRelease = { name: data.name, goal: data.goal, releaseId: data.releaseId };
    await db.sprint.update({
      where: { id },
      data: closed ? nameGoalRelease : { ...nameGoalRelease, startDate: parseDate(data.startDate), endDate: parseDate(data.endDate) },
    });
  } catch (err) {
    return fail(err);
  }
  refresh();
  return { ok: true };
}

export async function startSprint(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("sprints.run");
  try {
    const id = String(formData.get("id"));
    await db.$transaction(async (tx) => {
      const sprint = await tx.sprint.findUnique({ where: { id }, include: { items: true } });
      if (!sprint) throw new UserError("This sprint no longer exists.");
      if (sprint.state !== "PLANNED") throw new UserError("Only a planned sprint can be started.");
      const planned = sprint.items.filter((i) => i.type !== "TASK");
      if (planned.length === 0) throw new UserError("Add at least one user story or bug before starting the sprint.");
      // Commitment snapshot: tasks keep their hours, stories and bugs are recorded for the carry-over count.
      await tx.sprintCommitment.createMany({
        data: sprint.items.map((i) => ({ sprintId: id, workItemId: i.id, hours: i.type === "TASK" ? i.estimateHours ?? 0 : 0 })),
      });
      await tx.sprint.update({ where: { id }, data: { state: "ACTIVE", startedAt: new Date() } });
    });
  } catch (err) {
    return fail(err);
  }
  refresh();
  return { ok: true };
}

export async function closeSprint(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("sprints.run");
  try {
    const id = String(formData.get("id"));
    const carryTo = optionalId.parse(formData.get("carryTo"));
    const sprint = await db.sprint.findUnique({ where: { id } });
    if (!sprint) return { error: "This sprint no longer exists." };
    if (sprint.state !== "ACTIVE" && sprint.state !== "PAUSED") return { error: "Only an active or paused sprint can be closed." };
    if (carryTo) {
      const target = await db.sprint.findUnique({ where: { id: carryTo } });
      if (!target || target.lobId !== sprint.lobId || target.state === "CLOSED" || target.id === id) {
        return { error: "Choose another open sprint of the same line of business, or the backlog." };
      }
    }
    // Save the final numbers before anything moves.
    const analytics = await loadAnalytics({ asClosed: id });
    const view = analytics.sprints.find((s) => s.id === id);
    if (!view) return { error: "This sprint no longer exists." };

    await db.$transaction(async (tx) => {
      const items = await tx.workItem.findMany({ where: { sprintId: id, type: { in: ["STORY", "BUG"] } } });
      const carried = items.filter((i) => i.status !== "DONE");
      const result = { ...view.summary, carriedOverItems: carried.length };
      await tx.sprintCommitment.updateMany({
        where: { sprintId: id, workItemId: { in: carried.map((i) => i.id) } },
        data: { carriedOver: true },
      });
      // A sprint closed while paused ends its pause today.
      await tx.sprintPause.updateMany({ where: { sprintId: id, resumedOn: null }, data: { resumedOn: todayUTC() } });
      await tx.sprint.update({ where: { id }, data: { state: "CLOSED", closedAt: new Date(), result } });
      for (const item of carried) await moveItemToSprint(tx, item.id, carryTo);
    });
  } catch (err) {
    return fail(err);
  }
  refresh();
  return { ok: true };
}

export async function deleteSprint(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("sprints.manage");
  try {
    const id = String(formData.get("id"));
    const sprint = await db.sprint.findUnique({ where: { id }, include: { _count: { select: { items: true } } } });
    if (!sprint) return { error: "This sprint no longer exists." };
    if (sprint.state !== "PLANNED") return { error: "Only a planned sprint can be deleted. Active and closed sprints keep their history." };
    await db.$transaction(async (tx) => {
      const items = await tx.workItem.findMany({ where: { sprintId: id, type: { in: ["STORY", "BUG"] } } });
      for (const i of items) await moveItemToSprint(tx, i.id, null);
      await tx.sprint.delete({ where: { id } });
    });
  } catch (err) {
    return fail(err);
  }
  refresh();
  redirect("/sprints");
}

/**
 * Delete the selected sprints. Only planned sprints can go (active, paused and closed sprints keep their history).
 * Items in a deleted sprint go back to the backlog.
 */
export async function deleteSprints(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("sprints.manage");
  try {
    const ids = formData.getAll("id").map(String).filter(Boolean);
    if (ids.length === 0) return { error: "Tick at least one sprint first." };
    const sprints = await db.sprint.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, state: true, lob: { select: { key: true } } } });
    const deletable = sprints.filter((s) => s.state === "PLANNED");
    const skipped = sprints.filter((s) => s.state !== "PLANNED");
    await db.$transaction(async (tx) => {
      for (const sp of deletable) {
        const items = await tx.workItem.findMany({ where: { sprintId: sp.id, type: { in: ["STORY", "BUG"] } }, select: { id: true } });
        for (const i of items) await moveItemToSprint(tx, i.id, null);
        await tx.sprint.delete({ where: { id: sp.id } });
      }
    });
    refresh();
    const base = `Deleted ${deletable.length} sprint${deletable.length === 1 ? "" : "s"}.`;
    if (skipped.length === 0) return { ok: true, message: base };
    return {
      ok: deletable.length > 0,
      error: deletable.length === 0 ? "Nothing was deleted. Only planned sprints can be deleted." : undefined,
      message: deletable.length > 0 ? base : undefined,
      details: skipped.map((s) => `${s.lob.key} ${s.name} was kept: it is ${s.state.toLowerCase()}, and active, paused and closed sprints keep their history.`),
    };
  } catch (err) {
    return fail(err);
  }
}

/** Plan a story/bug into a sprint, or take it out (sprintId = null). */
export async function setItemSprint(itemId: string, sprintId: string | null): Promise<ActionState> {
  await requirePermission("sprints.manage");
  try {
    await db.$transaction((tx) => moveItemToSprint(tx, itemId, sprintId));
  } catch (err) {
    return fail(err);
  }
  refresh();
  return { ok: true };
}

/** Move a story/bug to the next planned sprint of its line of business. */
export async function moveToNextSprint(itemId: string): Promise<ActionState> {
  await requirePermission("timeline.act", "sprints.manage");
  try {
    await db.$transaction(async (tx) => {
      const item = await tx.workItem.findUnique({ where: { id: itemId }, include: { parent: true } });
      if (!item) throw new UserError("This item no longer exists.");
      const story = item.type === "TASK" ? item.parent : item;
      if (!story || !story.sprintId) throw new UserError("This item is not planned in a sprint.");
      const current = await tx.sprint.findUniqueOrThrow({ where: { id: story.sprintId } });
      const next = await tx.sprint.findFirst({
        where: { lobId: current.lobId, state: "PLANNED", id: { not: current.id }, startDate: { gt: current.startDate } },
        orderBy: { startDate: "asc" },
      });
      if (!next) throw new UserError("There is no later planned sprint. Create the next sprint first.");
      await moveItemToSprint(tx, story.id, next.id);
    });
  } catch (err) {
    return fail(err);
  }
  refresh();
  return { ok: true };
}

const shareSchema = z.object({
  sprintId: z.string().min(1),
  memberId: z.string().min(1),
  percent: z.preprocess(
    (v) => (v === "" || v == null ? null : Number(v)),
    z.number({ message: "Percent must be a number" }).min(0, "Percent cannot be negative").max(100, "Percent cannot exceed 100").nullable(),
  ),
});

/** Override how much of a member's hours this sprint gets while sprints overlap. Empty = even split. */
export async function saveSprintShare(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("sprints.manage");
  try {
    const d = shareSchema.parse(Object.fromEntries(formData.entries()));
    if (d.percent == null) {
      await db.sprintMemberShare.deleteMany({ where: { sprintId: d.sprintId, memberId: d.memberId } });
    } else {
      await db.sprintMemberShare.upsert({
        where: { sprintId_memberId: { sprintId: d.sprintId, memberId: d.memberId } },
        update: { percent: d.percent },
        create: { sprintId: d.sprintId, memberId: d.memberId, percent: d.percent },
      });
    }
  } catch (err) {
    return fail(err);
  }
  refresh();
  return { ok: true };
}

/** Accept the current planned dates of tasks as their new baseline. Dates are recalculated here, never trusted from the browser. */
export async function acceptBaseline(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("timeline.act", "sprints.manage");
  try {
    const ids = formData.getAll("taskId").map(String).filter(Boolean);
    if (ids.length === 0) return { error: "Nothing to accept." };
    const analytics = await loadAnalytics();
    for (const t of analytics.tasks.filter((x) => ids.includes(x.id))) {
      if (!t.plan?.start || !t.plan.end) continue;
      await db.taskBaseline.upsert({
        where: { workItemId: t.id },
        update: { baselineStart: t.plan.start, baselineEnd: t.plan.end, acceptedAt: new Date() },
        create: { workItemId: t.id, baselineStart: t.plan.start, baselineEnd: t.plan.end },
      });
    }
  } catch (err) {
    return fail(err);
  }
  refresh();
  return { ok: true };
}

export async function resetBaseline(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("timeline.act", "sprints.manage");
  try {
    await db.taskBaseline.deleteMany({ where: { workItemId: String(formData.get("id")) } });
  } catch (err) {
    return fail(err);
  }
  refresh();
  return { ok: true };
}

/** Change the assignee of a task from the timeline or board. */
export async function quickAssign(taskId: string, memberId: string | null): Promise<ActionState> {
  await requirePermission("timeline.act", "sprints.manage", "backlog.edit");
  try {
    await db.$transaction(async (tx) => {
      const task = await tx.workItem.findUnique({ where: { id: taskId }, include: { lob: true } });
      if (!task || task.type !== "TASK") throw new UserError("This task no longer exists.");
      if (memberId) {
        const ok = await tx.squadMembership.findFirst({ where: { memberId, squadId: task.lob.squadId } });
        if (!ok) throw new UserError("The assignee must be a member of the squad that owns this line of business.");
      }
      if (task.assigneeId === memberId) return;
      await tx.workItem.update({ where: { id: taskId }, data: { assigneeId: memberId } });
      await tx.workItemHistory.create({ data: { workItemId: taskId, field: "assignee", oldValue: task.assigneeId, newValue: memberId } });
    });
  } catch (err) {
    return fail(err);
  }
  refresh();
  return { ok: true };
}

/** Change a task's hour estimate (used from the timeline's re-estimate action). */
export async function quickEstimate(taskId: string, hours: number | null): Promise<ActionState> {
  await requirePermission("timeline.act", "sprints.manage", "backlog.edit");
  try {
    const h = z.number().min(0).max(1000).nullable().parse(hours);
    const task = await db.workItem.findUnique({ where: { id: taskId } });
    if (!task || task.type !== "TASK") return { error: "This task no longer exists." };
    if (task.estimateHours === h) return { ok: true };
    await db.$transaction([
      db.workItem.update({ where: { id: taskId }, data: { estimateHours: h } }),
      db.workItemHistory.create({ data: { workItemId: taskId, field: "estimate", oldValue: task.estimateHours == null ? null : String(task.estimateHours), newValue: h == null ? null : String(h) } }),
    ]);
  } catch (err) {
    return fail(err);
  }
  refresh();
  return { ok: true };
}

const pauseSchema = z.object({
  id: z.string().min(1),
  date: isoDate,
  reason: z.string().trim().max(500, "The reason is too long").default(""),
});

/** Put an active sprint on hold from a date (today or earlier). Its tasks are not scheduled and it takes no share of anyone's hours until it resumes. */
export async function pauseSprint(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("sprints.run");
  try {
    const d = pauseSchema.parse({ id: formData.get("id"), date: formData.get("date"), reason: formData.get("reason") ?? "" });
    await db.$transaction(async (tx) => {
      const sprint = await tx.sprint.findUnique({ where: { id: d.id }, include: { pauses: { orderBy: { startDate: "desc" }, take: 1 } } });
      if (!sprint) throw new UserError("This sprint no longer exists.");
      if (sprint.state !== "ACTIVE") throw new UserError(sprint.state === "PAUSED" ? "This sprint is already paused." : "Only an active sprint can be paused.");
      const from = parseDate(d.date);
      if (from.getTime() > todayUTC().getTime()) throw new UserError("A sprint can be paused from today or an earlier day, not a future day.");
      if (from.getTime() < sprint.startDate.getTime()) throw new UserError(`The pause cannot start before the sprint starts (${toISODate(sprint.startDate)}).`);
      const last = sprint.pauses[0];
      if (last?.resumedOn && from.getTime() < last.resumedOn.getTime()) throw new UserError(`The sprint was paused until ${toISODate(last.resumedOn)}. Choose a later day.`);
      await tx.sprintPause.create({ data: { sprintId: sprint.id, startDate: from, reason: d.reason } });
      await tx.sprint.update({ where: { id: sprint.id }, data: { state: "PAUSED" } });
    });
  } catch (err) {
    return fail(err);
  }
  refresh();
  return { ok: true };
}

/** Resume a paused sprint. With "extend" the end date moves out by the working days it was paused, so the team keeps its full time. */
export async function resumeSprint(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("sprints.run");
  try {
    const d = pauseSchema.omit({ reason: true }).parse({ id: formData.get("id"), date: formData.get("date") });
    const extend = formData.get("extend") === "on";
    const cal = await getWorkCalendar();
    await db.$transaction(async (tx) => {
      const sprint = await tx.sprint.findUnique({ where: { id: d.id }, include: { pauses: { where: { resumedOn: null }, take: 1 } } });
      if (!sprint) throw new UserError("This sprint no longer exists.");
      const pause = sprint.pauses[0];
      if (sprint.state !== "PAUSED" || !pause) throw new UserError("This sprint is not paused.");
      const on = parseDate(d.date);
      if (on.getTime() < pause.startDate.getTime()) throw new UserError(`The sprint was paused from ${toISODate(pause.startDate)}. Choose that day or a later one.`);
      if (on.getTime() > todayUTC().getTime()) throw new UserError("A sprint can be resumed from today or an earlier day, not a future day.");
      const pausedWorkingDays = on.getTime() > pause.startDate.getTime() ? workingDaysBetween(pause.startDate, addDays(on, -1), cal) : 0;
      const extendBy = extend ? pausedWorkingDays : 0;
      await tx.sprintPause.update({ where: { id: pause.id }, data: { resumedOn: on, extendedByDays: extendBy } });
      await tx.sprint.update({
        where: { id: sprint.id },
        data: { state: "ACTIVE", ...(extendBy > 0 ? { endDate: addWorkingDays(sprint.endDate, extendBy, cal) } : {}) },
      });
    });
  } catch (err) {
    return fail(err);
  }
  refresh();
  return { ok: true };
}
