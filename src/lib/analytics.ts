import "server-only";
import type { SprintState, WorkItemStatus, WorkItemType } from "@/lib/enums";
import { db } from "./db";
import { getSettings } from "./settings";
import { addDays, toISODate, todayUTC } from "./dates";
import { effectiveSprintLength, type LeaveRange, type WorkCalendar, dailyHours, workingDaysBetween } from "./capacity";
import {
  computeSprintMetrics,
  daysBetween,
  elapsedFraction,
  forecastFinish,
  idealRemainingOn,
  isSlipped,
  pausedDayKeys,
  scheduleTasks,
  sprintHealth,
  poolsFor,
  sprintMemberCapacity,
  type Health,
  type SprintMetrics,
  type SprintSpan,
  type TaskPlan,
} from "./planning";
import { itemKey } from "./work-items";

/** Everything we know about one sprint. Saved as JSON when the sprint is closed. */
export type SprintSummary = SprintMetrics & {
  capacityByMember: Record<string, number>;
  /** How each member's capacity was worked out when it comes from the sprint planning sheet */
  plans?: Record<string, { availabilityPct: number; initial: number; meetings: number; vacation: number; excuses: number; other: number }>;
  totalCapacity: number;
  overAllocated: boolean;
  committedItems: number;
  carriedOverItems: number;
  overloadedMembers: number;
  slippedTasks: number;
  health: Health;
};

export type SprintView = {
  id: string;
  name: string;
  goal: string;
  lobId: string;
  lobName: string;
  lobKey: string;
  squadId: string;
  squadName: string;
  start: Date;
  end: Date;
  lengthDays: number;
  state: SprintState;
  releaseId: string | null;
  startedAt: Date | null;
  closedAt: Date | null;
  summary: SprintSummary;
  /** Per-member share overrides (percent) */
  overrides: Record<string, number>;
  /** Every period the sprint was on hold, oldest first */
  pauses: { id: string; start: Date; resumedOn: Date | null; reason: string; extendedByDays: number; workingDays: number }[];
};

export type TaskView = {
  id: string;
  key: string;
  title: string;
  status: WorkItemStatus;
  blocked: boolean;
  lobId: string;
  lobName: string;
  squadId: string;
  squadName: string;
  sprintId: string;
  sprintName: string;
  sprintStart: Date;
  sprintEnd: Date;
  storyId: string | null;
  storyKey: string;
  storyTitle: string;
  assigneeId: string | null;
  assigneeName: string | null;
  hours: number | null;
  plan: TaskPlan | null;
  deadline: Date;
  baselineEnd: Date | null;
  slipped: boolean;
  issue: "unassigned" | "no-estimate" | "no-availability" | null;
  /** The sprint is on hold, so the task has no planned dates */
  sprintPaused: boolean;
  /** Position in the schedule (sprint start, story order, task order) */
  order: number;
};

export type ReleaseView = {
  id: string;
  name: string;
  version: string;
  notes: string;
  lobId: string;
  lobName: string;
  lobKey: string;
  squadId: string;
  squadName: string;
  targetDate: Date;
  deployedDate: Date | null;
  sprintIds: string[];
  totalHours: number;
  doneHours: number;
  remainingHours: number;
  forecast: Date | null;
  /** days the forecast is after the target (positive = late) */
  forecastDelayDays: number | null;
  changes: { id: string; oldDate: Date; newDate: Date; reason: string; changedAt: Date }[];
};

export type VelocityPoint = { sprintId: string; doneHours: number; lengthDays: number };

export type Analytics = {
  today: Date;
  cal: WorkCalendar;
  defaultSprintLength: number;
  squads: { id: string; name: string; sprintLengthDays: number | null }[];
  lobs: { id: string; name: string; key: string; squadId: string; sprintLengthDays: number | null }[];
  members: { id: string; name: string; active: boolean; squadIds: string[] }[];
  sprints: SprintView[];
  tasks: TaskView[];
  releases: ReleaseView[];
  /** closed sprints per LOB, oldest first */
  velocity: Record<string, VelocityPoint[]>;
  /** Days off of each member */
  leaves: Record<string, { start: Date; end: Date }[]>;
};

type ItemRow = {
  id: string;
  type: WorkItemType;
  number: number;
  title: string;
  status: WorkItemStatus;
  rank: number;
  lobId: string;
  parentId: string | null;
  sprintId: string | null;
  assigneeId: string | null;
  estimateHours: number | null;
  blocked: boolean;
  doneAt: Date | null;
  createdAt: Date;
};

export async function loadAnalytics(opts: { asClosed?: string } = {}): Promise<Analytics> {
  const today = todayUTC();
  const [settings, holidays, squads, lobs, members, sprintRows, items, baselines, releaseRows, sprintHistory, memberPlans, pauseRows] = await Promise.all([
    getSettings(),
    db.holiday.findMany(),
    db.squad.findMany({ orderBy: { name: "asc" } }),
    db.lineOfBusiness.findMany({ orderBy: { name: "asc" } }),
    db.member.findMany({ orderBy: { name: "asc" }, include: { memberships: { include: { lobAllocations: true } }, leaves: true } }),
    db.sprint.findMany({ include: { shares: true, commitments: true }, orderBy: [{ startDate: "asc" }, { name: "asc" }] }),
    db.workItem.findMany({
      select: {
        id: true, type: true, number: true, title: true, status: true, rank: true, lobId: true, parentId: true, sprintId: true,
        assigneeId: true, estimateHours: true, blocked: true, doneAt: true, createdAt: true,
      },
    }) as Promise<ItemRow[]>,
    db.taskBaseline.findMany(),
    db.release.findMany({ include: { changes: { orderBy: { changedAt: "desc" } } }, orderBy: { targetDate: "asc" } }),
    db.workItemHistory.findMany({
      where: { field: "sprint" },
      select: { workItemId: true, newValue: true, changedAt: true },
      orderBy: { changedAt: "asc" },
    }),
    db.sprintMemberPlan.findMany(),
    db.sprintPause.findMany({ orderBy: { startDate: "asc" } }),
  ]);

  const cal: WorkCalendar = { workingDays: settings.workingDays, holidays: new Set(holidays.map((h) => toISODate(h.date))) };
  const lobById = new Map(lobs.map((l) => [l.id, l]));
  const squadById = new Map(squads.map((s) => [s.id, s]));
  const memberById = new Map(members.map((m) => [m.id, m]));
  const itemById = new Map(items.map((i) => [i.id, i]));
  const baselineByTask = new Map(baselines.map((b) => [b.workItemId, b]));
  const keyOf = (i: ItemRow) => itemKey(lobById.get(i.lobId)!.key, i.number);

  // When did each task enter each sprint? (latest history row pointing at that sprint)
  const enteredAt = new Map<string, Date>();
  for (const h of sprintHistory) if (h.newValue) enteredAt.set(`${h.workItemId}|${h.newValue}`, h.changedAt);

  const pausesBySprint = new Map<string, typeof pauseRows>();
  for (const p of pauseRows) (pausesBySprint.get(p.sprintId) ?? pausesBySprint.set(p.sprintId, []).get(p.sprintId)!).push(p);
  const pausesOf = (sprintId: string) => pausesBySprint.get(sprintId) ?? [];

  // Sprint spans per squad (used to share a member's hours between overlapping sprints)
  const spanOf = (s: (typeof sprintRows)[number]): SprintSpan => ({
    id: s.id,
    startDate: s.startDate,
    endDate: s.endDate,
    overrides: Object.fromEntries(s.shares.map((x) => [x.memberId, x.percent])),
    pauses: pausesOf(s.id).map((p) => ({ start: p.startDate, end: p.resumedOn ? addDays(p.resumedOn, -1) : null })),
  });
  const spansBySquad = new Map<string, SprintSpan[]>();
  const spansByLob = new Map<string, SprintSpan[]>();
  for (const s of sprintRows) {
    const squadId = lobById.get(s.lobId)!.squadId;
    const span = spanOf(s);
    (spansBySquad.get(squadId) ?? spansBySquad.set(squadId, []).get(squadId)!).push(span);
    (spansByLob.get(s.lobId) ?? spansByLob.set(s.lobId, []).get(s.lobId)!).push(span);
  }

  const leavesOf = (memberId: string): LeaveRange[] => memberById.get(memberId)?.leaves ?? [];
  /** Squad hours of a member, split into the pool reserved for one LOB and the shared pool. */
  const poolsOf = (memberId: string, squadId: string, lobId: string) => {
    const ms = memberById.get(memberId)?.memberships.find((m) => m.squadId === squadId);
    if (!ms) return { lobWeekly: 0, sharedWeekly: 0 };
    const allocations = Object.fromEntries(ms.lobAllocations.filter((x) => lobById.get(x.lobId)?.squadId === squadId).map((x) => [x.lobId, x.weeklyHours]));
    return poolsFor(ms.weeklyHours, allocations, lobId);
  };

  // ---- capacity of each member in each sprint ----
  // Calculated from squad hours, leave, holidays and overlapping sprints. When the sprint planning sheet gave a member's
  // available hours ("Final Buffer"), those hours are used instead.
  const planOf = new Map(memberPlans.map((p) => [`${p.sprintId}|${p.memberId}`, p]));
  const calculated = new Map<string, { byMember: Record<string, number>; overAllocated: boolean }>();
  for (const s of sprintRows) {
    const lob = lobById.get(s.lobId)!;
    const squadSpans = spansBySquad.get(lob.squadId) ?? [];
    const span = squadSpans.find((x) => x.id === s.id)!;
    const byMember: Record<string, number> = {};
    let overAllocated = false;
    for (const m of members) {
      const ms = m.memberships.find((x) => x.squadId === lob.squadId);
      if (!ms || !m.active) continue;
      const c = sprintMemberCapacity({
        sprint: span,
        squadSprints: squadSpans,
        lobSprints: spansByLob.get(lob.id) ?? [],
        memberId: m.id,
        weeklyHours: ms.weeklyHours,
        pools: poolsOf(m.id, lob.squadId, lob.id),
        cal,
        leaves: m.leaves,
      });
      byMember[m.id] = c.hours;
      overAllocated ||= c.overAllocated;
    }
    calculated.set(s.id, { byMember, overAllocated });
  }
  /** Share of a member's available time that goes to tasks in this sprint (meetings, vacation and so on take the rest). */
  const efficiencyOf = (sprintId: string, memberId: string): number => {
    const plan = planOf.get(`${sprintId}|${memberId}`);
    const base = calculated.get(sprintId)?.byMember[memberId] ?? 0;
    return plan && base > 0 ? Math.min(1, Math.max(0.05, plan.capacityHours / base)) : 1;
  };

  // ---- timeline schedule for open tasks in planned and active sprints ----
  const sprintById = new Map(sprintRows.map((s) => [s.id, s]));
  const openTasks = items.filter((i) => {
    if (i.type !== "TASK" || i.status === "DONE" || !i.sprintId) return false;
    const sp = sprintById.get(i.sprintId);
    return sp != null && (sp.state !== "CLOSED" || sp.id === opts.asClosed);
  });
  const schedulable = openTasks
    .filter((t) => sprintById.get(t.sprintId!)?.state !== "PAUSED")
    .filter((t) => t.assigneeId && (t.estimateHours ?? 0) > 0 && memberById.get(t.assigneeId)?.active)
    .sort((a, b) => {
      const sa = sprintById.get(a.sprintId!)!;
      const sb = sprintById.get(b.sprintId!)!;
      const pa = a.parentId ? itemById.get(a.parentId) : undefined;
      const pb = b.parentId ? itemById.get(b.parentId) : undefined;
      return (
        sa.startDate.getTime() - sb.startDate.getTime() ||
        (pa?.rank ?? 0) - (pb?.rank ?? 0) ||
        a.rank - b.rank ||
        a.number - b.number
      );
    });
  const orderOf = new Map(schedulable.map((t, i) => [t.id, i]));
  const plans = scheduleTasks(
    schedulable.map((t) => ({
      id: t.id,
      memberId: t.assigneeId!,
      squadId: lobById.get(t.lobId)!.squadId,
      lobId: t.lobId,
      hours: t.estimateHours!,
      earliest: sprintById.get(t.sprintId!)!.startDate,
      efficiency: efficiencyOf(t.sprintId!, t.assigneeId!),
    })),
    (memberId, squadId, lobId, day) => {
      const pools = poolsOf(memberId, squadId, lobId);
      const leaves = leavesOf(memberId);
      return { lob: dailyHours(day, pools.lobWeekly, cal, leaves), shared: dailyHours(day, pools.sharedWeekly, cal, leaves) };
    },
    today,
  );

  const tasks: TaskView[] = openTasks.map((t) => {
    const sp = sprintById.get(t.sprintId!)!;
    const lob = lobById.get(t.lobId)!;
    const squad = squadById.get(lob.squadId)!;
    const story = t.parentId ? itemById.get(t.parentId) : undefined;
    const base = baselineByTask.get(t.id);
    const plan = plans.get(t.id) ?? null;
    const deadline = base?.baselineEnd ?? sp.endDate;
    const paused = sp.state === "PAUSED";
    const issue: TaskView["issue"] = paused ? null : !t.assigneeId
      ? "unassigned"
      : (t.estimateHours ?? 0) <= 0
        ? "no-estimate"
        : plan && plan.unscheduledHours > 0 && !plan.end
          ? "no-availability"
          : null;
    return {
      id: t.id,
      key: keyOf(t),
      title: t.title,
      status: t.status,
      blocked: t.blocked,
      lobId: lob.id,
      lobName: lob.name,
      squadId: squad.id,
      squadName: squad.name,
      sprintId: sp.id,
      sprintName: sp.name,
      sprintStart: sp.startDate,
      sprintEnd: sp.endDate,
      storyId: story?.id ?? null,
      storyKey: story ? keyOf(story) : "",
      storyTitle: story?.title ?? "",
      assigneeId: t.assigneeId,
      assigneeName: t.assigneeId ? memberById.get(t.assigneeId)?.name ?? null : null,
      hours: t.estimateHours,
      plan,
      deadline,
      baselineEnd: base?.baselineEnd ?? null,
      slipped: plan ? isSlipped(plan.end, deadline) : false,
      issue,
      sprintPaused: sp.state === "PAUSED",
      order: orderOf.get(t.id) ?? Number.MAX_SAFE_INTEGER,
    };
  });
  const taskView = new Map(tasks.map((t) => [t.id, t]));

  // ---- sprint summaries ----
  const velocity: Record<string, VelocityPoint[]> = {};
  const sprints: SprintView[] = sprintRows.map((s) => {
    const lob = lobById.get(s.lobId)!;
    const squad = squadById.get(lob.squadId)!;
    const lengthDays = daysBetween(s.startDate, s.endDate) + 1;
    const view: Omit<SprintView, "summary"> = {
      id: s.id,
      name: s.name,
      goal: s.goal,
      lobId: lob.id,
      lobName: lob.name,
      lobKey: lob.key,
      squadId: squad.id,
      squadName: squad.name,
      start: s.startDate,
      end: s.endDate,
      lengthDays,
      state: s.state,
      releaseId: s.releaseId,
      startedAt: s.startedAt,
      closedAt: s.closedAt,
      overrides: Object.fromEntries(s.shares.map((x) => [x.memberId, x.percent])),
      pauses: pausesOf(s.id).map((p) => {
        // For a pause that is still open, count the days before today: resuming today would not lose today.
        const lastPausedDay = addDays(p.resumedOn ?? today, -1);
        return {
          id: p.id,
          start: p.startDate,
          resumedOn: p.resumedOn,
          reason: p.reason,
          extendedByDays: p.extendedByDays,
          workingDays: lastPausedDay.getTime() >= p.startDate.getTime() ? workingDaysBetween(p.startDate, lastPausedDay, cal) : 0,
        };
      }),
    };
    const stored = s.state === "CLOSED" && s.id !== opts.asClosed ? readStoredSummary(s.result) : null;
    if (stored) {
      (velocity[lob.id] ??= []).push({ sprintId: s.id, doneHours: stored.doneHours, lengthDays });
      return { ...view, summary: stored };
    }

    const closing = s.id === opts.asClosed;
    const started = s.state !== "PLANNED";
    // Paused days do not count as working days of this sprint (burndown ideal line, time elapsed).
    const paused = pausedDayKeys(pausesOf(s.id).map((p) => ({ start: p.startDate, end: p.resumedOn ? addDays(p.resumedOn, -1) : null })), s.startDate, s.endDate, today);
    const sprintCal: WorkCalendar = paused.size ? { workingDays: cal.workingDays, holidays: new Set([...cal.holidays, ...paused]) } : cal;
    const sprintTasks = items.filter((i) => i.type === "TASK" && i.sprintId === s.id);
    const committed: Record<string, number> = {};
    let committedItems = 0;
    let carriedOverItems = 0;
    for (const c of s.commitments) {
      const it = itemById.get(c.workItemId);
      if (!it) continue;
      if (it.type === "TASK") committed[c.workItemId] = c.hours;
      else {
        committedItems += 1;
        if (c.carriedOver) carriedOverItems += 1;
      }
    }
    const metrics = computeSprintMetrics({
      start: s.startDate,
      end: s.endDate,
      started,
      closed: closing,
      today,
      cal: sprintCal,
      committed,
      tasks: sprintTasks.map((t) => {
        const parent = t.parentId ? itemById.get(t.parentId) : undefined;
        return {
          id: t.id,
          estimate: t.estimateHours ?? 0,
          done: t.status === "DONE",
          doneAt: t.doneAt,
          assigneeId: t.assigneeId,
          addedAt: enteredAt.get(`${t.id}|${s.id}`) ?? t.createdAt,
          isBug: parent?.type === "BUG",
          blocked: t.blocked,
        };
      }),
    });

    // Capacity of each squad member for this sprint (the planning sheet's numbers win over the calculation)
    const calc = calculated.get(s.id)!;
    const capacityByMember: Record<string, number> = { ...calc.byMember };
    const overAllocated = calc.overAllocated;
    const planDetails: NonNullable<SprintSummary["plans"]> = {};
    for (const p of memberPlans.filter((x) => x.sprintId === s.id)) {
      capacityByMember[p.memberId] = p.capacityHours;
      planDetails[p.memberId] = { availabilityPct: p.availabilityPct, initial: p.initialHours, meetings: p.meetingsHours, vacation: p.vacationHours, excuses: p.excuseHours, other: p.otherHours };
    }
    const totalCapacity = Object.values(capacityByMember).reduce((a, b) => a + b, 0);
    const memberIds = new Set([...Object.keys(capacityByMember), ...Object.keys(metrics.byMember)]);
    let overloadedMembers = 0;
    for (const id of memberIds) {
      const assigned = metrics.byMember[id]?.assigned ?? 0;
      const cap = capacityByMember[id] ?? 0;
      if (assigned > cap + 0.01) overloadedMembers += 1;
    }
    const slippedTasks = sprintTasks.filter((t) => taskView.get(t.id)?.slipped).length;
    const health = sprintHealth({
      committedHours: metrics.committedHours,
      doneHours: metrics.doneHours,
      remainingHours: metrics.remainingHours,
      idealRemaining: idealRemainingOn(metrics.burndown, today, metrics.committedHours),
      elapsed: started ? elapsedFraction(s.startDate, s.endDate, today, sprintCal) : 0,
      closed: closing,
      scopeChangePct: metrics.scopeChangePct,
      overloadedMembers,
      members: memberIds.size,
      blockedOrSlipped: sprintTasks.filter((t) => t.status !== "DONE" && (t.blocked || taskView.get(t.id)?.slipped)).length,
      openTasks: metrics.openTasks,
    });
    return {
      ...view,
      summary: { ...metrics, capacityByMember, plans: planDetails, totalCapacity: Math.round(totalCapacity * 100) / 100, overAllocated, committedItems, carriedOverItems, overloadedMembers, slippedTasks, health },
    };
  });

  // ---- releases ----
  const releases: ReleaseView[] = releaseRows.map((r) => {
    const lob = lobById.get(r.lobId)!;
    const squad = squadById.get(lob.squadId)!;
    const rs = sprints.filter((s) => s.releaseId === r.id);
    const open = rs.filter((s) => s.state !== "CLOSED");
    const doneHours = rs.reduce((a, s) => a + s.summary.doneHours, 0);
    const remainingHours = open.reduce((a, s) => a + s.summary.remainingHours, 0);
    const recent = (velocity[lob.id] ?? []).slice(-3);
    const forecast = r.deployedDate ? null : forecastFinish(remainingHours, recent, today);
    return {
      id: r.id,
      name: r.name,
      version: r.version,
      notes: r.notes,
      lobId: lob.id,
      lobName: lob.name,
      lobKey: lob.key,
      squadId: squad.id,
      squadName: squad.name,
      targetDate: r.targetDate,
      deployedDate: r.deployedDate,
      sprintIds: rs.map((s) => s.id),
      totalHours: Math.round((doneHours + remainingHours) * 100) / 100,
      doneHours: Math.round(doneHours * 100) / 100,
      remainingHours: Math.round(remainingHours * 100) / 100,
      forecast,
      forecastDelayDays: forecast ? daysBetween(r.targetDate, forecast) : null,
      changes: r.changes,
    };
  });

  return {
    today,
    cal,
    defaultSprintLength: settings.defaultSprintLengthDays,
    squads: squads.map((s) => ({ id: s.id, name: s.name, sprintLengthDays: s.sprintLengthDays })),
    lobs: lobs.map((l) => ({ id: l.id, name: l.name, key: l.key, squadId: l.squadId, sprintLengthDays: l.sprintLengthDays })),
    members: members.map((m) => ({ id: m.id, name: m.name, active: m.active, squadIds: m.memberships.map((x) => x.squadId) })),
    sprints,
    tasks,
    releases,
    velocity,
    leaves: Object.fromEntries(members.map((m) => [m.id, m.leaves.map((l) => ({ start: l.startDate, end: l.endDate }))])),
  };
}

/** Default sprint length for a LOB (LOB -> squad -> system default). */
export function sprintLengthFor(a: Analytics, lobId: string): number {
  const lob = a.lobs.find((l) => l.id === lobId);
  const squad = lob ? a.squads.find((s) => s.id === lob.squadId) : undefined;
  return effectiveSprintLength(lob?.sprintLengthDays, squad?.sprintLengthDays, a.defaultSprintLength);
}

/** The last three closed sprints of a LOB, newest last. */
export function recentVelocity(a: Analytics, lobId: string, n = 3): VelocityPoint[] {
  return (a.velocity[lobId] ?? []).slice(-n);
}

/** A closed sprint's saved results are stored as JSON text. */
function readStoredSummary(value: string | null): SprintSummary | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as SprintSummary;
  } catch {
    return null;
  }
}
