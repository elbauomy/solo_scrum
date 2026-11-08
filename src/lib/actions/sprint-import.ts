"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { workingDaysBetween } from "@/lib/capacity";
import { parseDate } from "@/lib/dates";
import { findPlanningSheet, readGrids } from "@/lib/excel";
import { getWorkCalendar } from "@/lib/settings";
import { parseSprintSheet, planSprintImport, resolveLob, type ImportOps, type MemberRef, type PlanItem } from "@/lib/sprint-sheet";
import { type ActionState, toActionError } from "@/lib/action-state";

const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Read a sprint planning sheet (.xlsx or .csv).
 * mode "check": show what would happen. mode "import": create or update the sprint, its members' capacity, stories and tasks.
 */
export async function importSprintPlan(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("sprints.import");
  try {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return { error: "Please choose your sprint planning file (.xlsx or .csv)." };
    if (!/\.(xlsx|csv)$/i.test(file.name)) return { error: "The file must be an Excel .xlsx file or a .csv file." };
    if (file.size > MAX_BYTES) return { error: "The file is larger than 5 MB." };
    const mode = formData.get("mode") === "import" ? "import" : "check";
    const lobOverrideId = String(formData.get("lobId") ?? "") || undefined;

    let grids;
    try {
      grids = await readGrids(file.name, await file.arrayBuffer());
    } catch {
      return { error: "This file could not be read. Please upload the .xlsx or .csv of your sprint planning sheet." };
    }
    const found = findPlanningSheet(grids);
    if (!found) {
      return { error: `No sheet with a "Team Member" heading was found. Sheets in the file: ${grids.map((g) => g.sheet).join(", ") || "none"}.` };
    }
    const parsed = parseSprintSheet(found.grid);

    const [lobRows, cal, settings] = await Promise.all([
      db.lineOfBusiness.findMany({ include: { squad: { select: { name: true } } } }),
      getWorkCalendar(),
      db.setting.findUnique({ where: { id: 1 } }),
    ]);
    const lobs = lobRows.map((l) => ({ id: l.id, name: l.name, key: l.key, squadId: l.squadId, squadName: l.squad.name }));
    const lob = resolveLob(parsed, lobs, lobOverrideId).lob;

    const [members, releases, sprints, items] = await Promise.all([
      db.member.findMany({ include: { memberships: { select: { squadId: true } } } }),
      db.release.findMany({ select: { id: true, lobId: true, name: true } }),
      db.sprint.findMany({ select: { id: true, lobId: true, name: true, state: true, releaseId: true } }),
      lob
        ? db.workItem.findMany({
            where: { lobId: lob.id, type: { in: ["STORY", "BUG", "TASK"] } },
            select: { id: true, type: true, title: true, status: true, sprintId: true, parentId: true, assigneeId: true, estimateHours: true, rank: true },
          })
        : Promise.resolve([]),
    ]);

    const calendarDays = parsed.from && parsed.to ? workingDaysBetween(parseDate(parsed.from), parseDate(parsed.to), cal) : 0;
    const plan = planSprintImport(parsed, {
      lobs,
      lobOverrideId,
      members: members.map((m) => ({ id: m.id, name: m.name, role: m.role, active: m.active, squadIds: m.memberships.map((x) => x.squadId) })),
      releases,
      sprints,
      items: items as PlanItem[],
      workingDaysPerWeek: settings?.workingDays.length ?? 5,
      calendarDays,
    });

    if (plan.errors.length > 0 || !plan.ops) {
      return {
        error: `The sheet has ${plan.errors.length} problem(s). Nothing was imported.`,
        details: plan.errors,
        preview: plan.preview ?? undefined,
      };
    }
    if (mode === "check") {
      return { ok: true, message: "The sheet is valid. Review what will happen below, then click Import.", preview: plan.preview! };
    }

    const sprintId = await db.$transaction((tx) => applyOps(tx, plan.ops!), { timeout: 60000, maxWait: 10000 });
    revalidatePath("/", "layout");
    const t = plan.preview!.totals;
    return {
      ok: true,
      message: `Imported ${plan.preview!.sprint.name}: ${t.stories} stor${t.stories === 1 ? "y" : "ies"} (${t.newStories} new), ${t.tasks} tasks (${t.newTasks} new, ${t.updatedTasks} updated), ${t.hours} hours.`,
      preview: plan.preview!,
      link: { href: `/sprints/${sprintId}`, label: `Open ${plan.preview!.sprint.name}` },
    };
  } catch (err) {
    return toActionError(err);
  }
}

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

async function applyOps(tx: Tx, ops: ImportOps): Promise<string> {
  // ---- members and squad membership
  const newMemberIds = ops.newMembers.map(() => randomUUID());
  if (ops.newMembers.length) {
    await tx.member.createMany({ data: ops.newMembers.map((m, i) => ({ id: newMemberIds[i], name: m.name, role: m.role })) });
  }
  const memberId = (ref: MemberRef) => ("existingId" in ref ? ref.existingId : newMemberIds[ref.newIndex]);
  if (ops.memberships.length) {
    await tx.squadMembership.createMany({
      data: ops.memberships.map((m) => ({ memberId: memberId(m.member), squadId: ops.squadId, weeklyHours: m.weeklyHours })),
      skipDuplicates: true,
    });
  }

  // ---- sprint
  const s = ops.sprint;
  const sprintId = s.existingId
    ? (await tx.sprint.update({ where: { id: s.existingId }, data: { startDate: parseDate(s.startDate), endDate: parseDate(s.endDate), releaseId: s.releaseId } })).id
    : (await tx.sprint.create({ data: { lobId: ops.lobId, name: s.name, startDate: parseDate(s.startDate), endDate: parseDate(s.endDate), releaseId: s.releaseId } })).id;

  // ---- each member's capacity for this sprint
  await tx.sprintMemberPlan.deleteMany({ where: { sprintId } });
  if (ops.plans.length) {
    await tx.sprintMemberPlan.createMany({
      data: ops.plans.map((p) => ({
        sprintId,
        memberId: memberId(p.member),
        availabilityPct: p.availabilityPct,
        initialHours: p.initialHours,
        meetingsHours: p.meetingsHours,
        vacationHours: p.vacationHours,
        excuseHours: p.excuseHours,
        otherHours: p.otherHours,
        capacityHours: p.capacityHours,
      })),
    });
  }

  // ---- numbering and ranks
  const lob = await tx.lineOfBusiness.findUniqueOrThrow({ where: { id: ops.lobId }, select: { nextItemNumber: true } });
  let number = lob.nextItemNumber;
  const topRank = (await tx.workItem.aggregate({ where: { lobId: ops.lobId, parentId: null }, _max: { rank: true } }))._max.rank ?? 0;
  const existingStoryIds = [...new Set(ops.newTasks.flatMap((t) => ("existingId" in t.story ? [t.story.existingId] : [])))];
  const childRanks = await tx.workItem.groupBy({ by: ["parentId"], where: { parentId: { in: existingStoryIds } }, _max: { rank: true } });
  const nextChildRank = new Map<string, number>(childRanks.map((r) => [r.parentId as string, r._max.rank ?? 0]));

  const storyRows: { id: string; type: "STORY"; number: number; title: string; description: string; lobId: string; rank: number; sprintId: string }[] = [];
  const newStoryIds = ops.newStories.map(() => randomUUID());
  const taskRows: {
    id: string; type: "TASK"; number: number; title: string; lobId: string; parentId: string; assigneeId: string; estimateHours: number; rank: number; sprintId: string;
  }[] = [];
  const history: { workItemId: string; field: string; oldValue: string | null; newValue: string | null }[] = [];

  ops.newStories.forEach((st, i) => {
    const id = newStoryIds[i];
    storyRows.push({ id, type: "STORY", number: number++, title: st.title, description: st.description, lobId: ops.lobId, rank: topRank + i + 1, sprintId });
    history.push({ workItemId: id, field: "created", oldValue: null, newValue: "STORY" }, { workItemId: id, field: "sprint", oldValue: null, newValue: sprintId });
    // tasks of this new story, directly after it so the numbers read in order
    for (const t of ops.newTasks.filter((x) => "newIndex" in x.story && x.story.newIndex === i)) {
      const rank = (nextChildRank.get(id) ?? 0) + 1;
      nextChildRank.set(id, rank);
      const tid = randomUUID();
      taskRows.push({ id: tid, type: "TASK", number: number++, title: t.title, lobId: ops.lobId, parentId: id, assigneeId: memberId(t.member), estimateHours: t.hours, rank, sprintId });
      history.push({ workItemId: tid, field: "created", oldValue: null, newValue: "TASK" }, { workItemId: tid, field: "sprint", oldValue: null, newValue: sprintId });
    }
  });
  for (const t of ops.newTasks.filter((x) => "existingId" in x.story)) {
    const parentId = (t.story as { existingId: string }).existingId;
    const rank = (nextChildRank.get(parentId) ?? 0) + 1;
    nextChildRank.set(parentId, rank);
    const tid = randomUUID();
    taskRows.push({ id: tid, type: "TASK", number: number++, title: t.title, lobId: ops.lobId, parentId, assigneeId: memberId(t.member), estimateHours: t.hours, rank, sprintId });
    history.push({ workItemId: tid, field: "created", oldValue: null, newValue: "TASK" }, { workItemId: tid, field: "sprint", oldValue: null, newValue: sprintId });
  }

  // ---- existing stories: plan them into the sprint, their open tasks follow
  if (ops.moveStories.length) {
    const ids = ops.moveStories.map((m) => m.id);
    const stories = await tx.workItem.findMany({ where: { id: { in: ids } }, select: { id: true, sprintId: true } });
    const openTasks = await tx.workItem.findMany({ where: { parentId: { in: ids }, type: "TASK", status: { not: "DONE" } }, select: { id: true, sprintId: true } });
    const moving = [...stories, ...openTasks].filter((i) => i.sprintId !== sprintId);
    if (moving.length) {
      await tx.workItem.updateMany({ where: { id: { in: moving.map((m) => m.id) } }, data: { sprintId } });
      for (const m of moving) history.push({ workItemId: m.id, field: "sprint", oldValue: m.sprintId, newValue: sprintId });
    }
  }

  if (storyRows.length) await tx.workItem.createMany({ data: storyRows });
  if (taskRows.length) await tx.workItem.createMany({ data: taskRows });
  for (const u of ops.updateTasks) {
    await tx.workItem.update({ where: { id: u.id }, data: { estimateHours: u.hours } });
    history.push({ workItemId: u.id, field: "estimate", oldValue: u.oldHours == null ? null : String(u.oldHours), newValue: String(u.hours) });
  }
  if (history.length) await tx.workItemHistory.createMany({ data: history });
  await tx.lineOfBusiness.update({ where: { id: ops.lobId }, data: { nextItemNumber: number } });
  return sprintId;
}
