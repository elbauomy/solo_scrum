import "server-only";
import type { WorkItemType } from "@/lib/enums";
import { db } from "./db";
import { loadAnalytics, type Analytics, type SprintView } from "./analytics";
import { addDays, formatDate, toISODate } from "./dates";
import { dateParam } from "./filters";
import { cycleTimeDays, movingAverage } from "./planning";
import { TYPE_LABEL, itemKey } from "./work-items";

export type Col = { key: string; label: string; numeric?: boolean };
export type Row = Record<string, string | number | null>;
export type ReportTable = { id: string; title: string; description: string; columns: Col[]; rows: Row[] };

export type ReportFilters = {
  squad?: string;
  lob?: string;
  sprint?: string;
  last?: string;
  from?: string;
  to?: string;
  member?: string;
  release?: string;
  type?: string;
};

export const REPORTS: { id: string; label: string }[] = [
  { id: "health", label: "Sprint health" },
  { id: "velocity", label: "Velocity" },
  { id: "burndown", label: "Burndown" },
  { id: "capacity", label: "Capacity & load" },
  { id: "productivity", label: "Productivity" },
  { id: "quality", label: "Commitment, scope & bugs" },
  { id: "cycle", label: "Cycle time" },
  { id: "releases", label: "Release forecast" },
];

export type ReportBundle = {
  a: Analytics;
  sprints: SprintView[];
  burndownSprint: SprintView | null;
  tables: Record<string, ReportTable>;
  charts: {
    velocity: { label: string; committed: number; done: number; average: number | null }[];
    load: { label: string; capacity: number; assigned: number; done: number }[];
    productivity: { label: string; productivity: number }[];
    quality: { label: string; reliability: number; scope: number; carry: number }[];
  };
};

const r1 = (n: number) => Math.round(n * 10) / 10;
const pctOf = (a: number, b: number) => (b > 0 ? r1((a / b) * 100) : null);

/** Pick the sprints a report covers from the filters. */
export function selectSprints(a: Analytics, f: ReportFilters): SprintView[] {
  if (f.sprint) return a.sprints.filter((s) => s.id === f.sprint);
  const from = dateParam(f.from);
  const to = dateParam(f.to);
  const lastN = Math.max(1, Math.min(52, Number(f.last) || 6));
  let list = a.sprints.filter((s) => s.state !== "PLANNED");
  list = list.filter((s) => (!f.squad || s.squadId === f.squad) && (!f.lob || s.lobId === f.lob) && (!f.release || s.releaseId === f.release));
  if (from || to) return list.filter((s) => (!from || s.end >= from) && (!to || s.start <= to));
  // Last N sprints of each line of business
  const byLob = new Map<string, SprintView[]>();
  for (const s of list) (byLob.get(s.lobId) ?? byLob.set(s.lobId, []).get(s.lobId)!).push(s);
  return [...byLob.values()].flatMap((x) => x.slice(-lastN));
}

export async function buildReports(f: ReportFilters): Promise<ReportBundle> {
  const a = await loadAnalytics();
  const sprints = selectSprints(a, f).sort((x, y) => x.lobName.localeCompare(y.lobName) || x.start.getTime() - y.start.getTime());
  const memberName = new Map(a.members.map((m) => [m.id, m.name]));
  const label = (s: SprintView) => `${s.lobKey} ${s.name}`;

  // ---- sprint health ----
  const health: ReportTable = {
    id: "health",
    title: "Sprint health",
    description: "Score out of 100: 30% burndown on track, 25% commitment reliability, 15% scope stability, 15% load balance, 15% blocked or slipped tasks. Green 80+, amber 60–79, red below 60.",
    columns: [
      { key: "sprint", label: "Sprint" },
      { key: "lob", label: "Line of Business" },
      { key: "squad", label: "Squad" },
      { key: "state", label: "State" },
      { key: "score", label: "Score", numeric: true },
      { key: "level", label: "Level" },
      { key: "burndown", label: "Burndown %", numeric: true },
      { key: "reliability", label: "Reliability %", numeric: true },
      { key: "scope", label: "Scope %", numeric: true },
      { key: "load", label: "Load %", numeric: true },
      { key: "blocked", label: "Blocked/slipped %", numeric: true },
    ],
    rows: sprints.map((s) => ({
      sprint: s.name, lob: s.lobName, squad: s.squadName, state: s.state.toLowerCase(),
      score: s.summary.health.score, level: s.summary.health.level,
      burndown: s.summary.health.parts.burndown, reliability: s.summary.health.parts.reliability, scope: s.summary.health.parts.scope,
      load: s.summary.health.parts.load, blocked: s.summary.health.parts.blocked,
    })),
  };

  // ---- velocity (trailing 3-sprint average within the same line of business) ----
  const doneByLob = new Map<string, { id: string; done: number }[]>();
  for (const s of a.sprints.filter((x) => x.state !== "PLANNED")) (doneByLob.get(s.lobId) ?? doneByLob.set(s.lobId, []).get(s.lobId)!).push({ id: s.id, done: s.summary.doneHours });
  const average = (s: SprintView): number | null => {
    const list = doneByLob.get(s.lobId) ?? [];
    const idx = list.findIndex((x) => x.id === s.id);
    return idx < 0 ? null : movingAverage(list.slice(0, idx + 1).map((x) => x.done), 3);
  };
  const velocity: ReportTable = {
    id: "velocity",
    title: "Velocity",
    description: "Hours of tasks marked Done in each sprint. The average is over the last 3 sprints of the same line of business.",
    columns: [
      { key: "sprint", label: "Sprint" }, { key: "lob", label: "Line of Business" }, { key: "squad", label: "Squad" }, { key: "state", label: "State" },
      { key: "committed", label: "Committed h", numeric: true }, { key: "done", label: "Done h (velocity)", numeric: true },
      { key: "average", label: "Average of last 3 h", numeric: true }, { key: "reliability", label: "Done / committed %", numeric: true },
    ],
    rows: sprints.map((s) => ({
      sprint: s.name, lob: s.lobName, squad: s.squadName, state: s.state.toLowerCase(),
      committed: s.summary.committedHours, done: s.summary.doneHours, average: average(s) == null ? null : r1(average(s)!), reliability: s.summary.reliabilityPct == null ? null : r1(s.summary.reliabilityPct),
    })),
  };

  // ---- burndown of one sprint ----
  const burndownSprint = sprints.find((s) => s.id === f.sprint) ?? [...sprints].reverse().find((s) => s.state === "ACTIVE") ?? sprints[sprints.length - 1] ?? null;
  const burndown: ReportTable = {
    id: "burndown",
    title: burndownSprint ? `Burndown — ${burndownSprint.lobKey} ${burndownSprint.name}` : "Burndown",
    description: "Remaining hours at the end of each day. Hours burn only when a task is marked Done. The ideal line falls over working days.",
    columns: [{ key: "date", label: "Date" }, { key: "ideal", label: "Ideal h", numeric: true }, { key: "actual", label: "Remaining h", numeric: true }],
    rows: (burndownSprint?.summary.burndown ?? []).map((p) => ({ date: p.date, ideal: p.ideal, actual: p.actual })),
  };

  // ---- capacity & load per member per sprint ----
  const capacityRows: Row[] = [];
  const load: ReportBundle["charts"]["load"] = [];
  for (const s of sprints) {
    const ids = new Set([...Object.keys(s.summary.capacityByMember), ...Object.keys(s.summary.byMember)]);
    for (const id of ids) {
      if (f.member && f.member !== id) continue;
      const cap = s.summary.capacityByMember[id] ?? 0;
      const assigned = s.summary.byMember[id]?.assigned ?? 0;
      const done = s.summary.byMember[id]?.done ?? 0;
      capacityRows.push({ sprint: s.name, lob: s.lobName, member: memberName.get(id) ?? "Removed member", capacity: r1(cap), assigned: r1(assigned), load: pctOf(assigned, cap), done: r1(done) });
      if (sprints.length === 1 || s.id === burndownSprint?.id) load.push({ label: memberName.get(id) ?? "Removed member", capacity: r1(cap), assigned: r1(assigned), done: r1(done) });
    }
  }
  const capacity: ReportTable = {
    id: "capacity",
    title: "Capacity and load",
    description: "Capacity = hours the member has for the sprint after weekends, holidays, leave and sharing with overlapping sprints. Load = assigned task hours ÷ capacity (aim for 70–100%).",
    columns: [
      { key: "sprint", label: "Sprint" }, { key: "lob", label: "Line of Business" }, { key: "member", label: "Member" },
      { key: "capacity", label: "Capacity h", numeric: true }, { key: "assigned", label: "Assigned h", numeric: true },
      { key: "load", label: "Load %", numeric: true }, { key: "done", label: "Done h", numeric: true },
    ],
    rows: capacityRows,
  };

  // ---- productivity per member across the selected sprints ----
  const perMember = new Map<string, { sprints: number; capacity: number; done: number }>();
  for (const s of sprints) {
    for (const id of new Set([...Object.keys(s.summary.capacityByMember), ...Object.keys(s.summary.byMember)])) {
      if (f.member && f.member !== id) continue;
      const m = perMember.get(id) ?? { sprints: 0, capacity: 0, done: 0 };
      m.sprints += 1;
      m.capacity += s.summary.capacityByMember[id] ?? 0;
      m.done += s.summary.byMember[id]?.done ?? 0;
      perMember.set(id, m);
    }
  }
  const prodRows = [...perMember.entries()]
    .map(([id, m]) => ({ member: memberName.get(id) ?? "Removed member", sprints: m.sprints, capacity: r1(m.capacity), done: r1(m.done), productivity: pctOf(m.done, m.capacity) }))
    .sort((x, y) => x.member.localeCompare(y.member));
  const productivity: ReportTable = {
    id: "productivity",
    title: "Productivity",
    description: "Done hours ÷ the member's available hours in the selected sprints. Use it for coaching and planning, not for ranking people.",
    columns: [{ key: "member", label: "Member" }, { key: "sprints", label: "Sprints", numeric: true }, { key: "capacity", label: "Capacity h", numeric: true }, { key: "done", label: "Done h", numeric: true }, { key: "productivity", label: "Productivity %", numeric: true }],
    rows: prodRows,
  };

  // ---- commitment, scope, carry-over, bugs ----
  const quality: ReportTable = {
    id: "quality",
    title: "Commitment, scope change, carry-over and bugs",
    description: "Reliability = done ÷ committed hours (target 80%+). Scope change = hours added or removed after start ÷ committed (target 10% or less). Carry-over = committed stories/bugs not finished (target 15% or less). Bug ratio = bug task hours ÷ all task hours.",
    columns: [
      { key: "sprint", label: "Sprint" }, { key: "lob", label: "Line of Business" },
      { key: "reliability", label: "Reliability %", numeric: true }, { key: "added", label: "Added h", numeric: true }, { key: "removed", label: "Removed h", numeric: true },
      { key: "scope", label: "Scope change %", numeric: true }, { key: "committedItems", label: "Committed items", numeric: true }, { key: "carried", label: "Carried over", numeric: true },
      { key: "carry", label: "Carry-over %", numeric: true }, { key: "bugHours", label: "Bug h", numeric: true }, { key: "bugRatio", label: "Bug ratio %", numeric: true },
    ],
    rows: sprints.map((s) => ({
      sprint: s.name, lob: s.lobName, reliability: s.summary.reliabilityPct == null ? null : r1(s.summary.reliabilityPct),
      added: s.summary.addedHours, removed: s.summary.removedHours, scope: r1(s.summary.scopeChangePct),
      committedItems: s.summary.committedItems, carried: s.summary.carriedOverItems, carry: pctOf(s.summary.carriedOverItems, s.summary.committedItems),
      bugHours: s.summary.bugHours, bugRatio: r1(s.summary.bugRatioPct),
    })),
  };

  // ---- cycle time (needs history) ----
  const cycle = await buildCycleTable(a, f, sprints);

  // ---- release forecast ----
  const from = dateParam(f.from);
  const to = dateParam(f.to);
  const releases: ReportTable = {
    id: "releases",
    title: "Release forecast",
    description: "Forecast = today + remaining hours of the release's open sprints ÷ average hours done per day over the line's last 3 closed sprints. Delay is measured against the current target date.",
    columns: [
      { key: "release", label: "Release" }, { key: "lob", label: "Line of Business" }, { key: "target", label: "Target" }, { key: "moved", label: "Date changes", numeric: true },
      { key: "forecast", label: "Forecast" }, { key: "delay", label: "Delay days", numeric: true }, { key: "done", label: "Done h", numeric: true }, { key: "remaining", label: "Remaining h", numeric: true }, { key: "deployed", label: "Deployed" },
    ],
    rows: a.releases
      .filter((r) => (!f.squad || r.squadId === f.squad) && (!f.lob || r.lobId === f.lob) && (!f.release || r.id === f.release) && (!from || r.targetDate >= from) && (!to || r.targetDate <= to))
      .map((r) => ({
        release: r.version ? `${r.name} v${r.version}` : r.name, lob: r.lobName, target: formatDate(r.targetDate), moved: r.changes.length,
        forecast: r.deployedDate ? "Deployed" : r.forecast ? formatDate(r.forecast) : "No forecast", delay: r.forecastDelayDays, done: r.doneHours, remaining: r.remainingHours,
        deployed: r.deployedDate ? formatDate(r.deployedDate) : "",
      })),
  };

  const charts: ReportBundle["charts"] = {
    velocity: sprints.map((s) => ({ label: label(s), committed: s.summary.committedHours, done: s.summary.doneHours, average: average(s) == null ? null : r1(average(s)!) })),
    load,
    productivity: prodRows.map((p) => ({ label: p.member, productivity: p.productivity ?? 0 })),
    quality: sprints.map((s) => ({ label: label(s), reliability: r1(s.summary.reliabilityPct ?? 0), scope: r1(s.summary.scopeChangePct), carry: pctOf(s.summary.carriedOverItems, s.summary.committedItems) ?? 0 })),
  };

  return {
    a,
    sprints,
    burndownSprint,
    tables: { health, velocity, burndown, capacity, productivity, quality, cycle, releases },
    charts,
  };
}

async function buildCycleTable(a: Analytics, f: ReportFilters, sprints: SprintView[]): Promise<ReportTable> {
  const types: WorkItemType[] = f.type === "STORY" || f.type === "BUG" || f.type === "TASK" ? [f.type] : ["STORY", "BUG", "TASK"];
  const from = dateParam(f.from);
  const to = dateParam(f.to);
  const restrictToSprints = Boolean(f.sprint || f.release);
  const lobIds = a.lobs.filter((l) => (!f.squad || l.squadId === f.squad) && (!f.lob || l.id === f.lob)).map((l) => l.id);
  const since = from ?? (restrictToSprints ? null : addDays(a.today, -90));
  const items = await db.workItem.findMany({
    where: {
      type: { in: types },
      status: "DONE",
      doneAt: { not: null, ...(since ? { gte: since } : {}), ...(to ? { lt: addDays(to, 1) } : {}) },
      lobId: { in: lobIds },
      ...(f.member ? { assigneeId: f.member } : {}),
      ...(restrictToSprints ? { sprintId: { in: sprints.map((s) => s.id) } } : {}),
    },
    include: { lob: { select: { key: true } }, assignee: { select: { name: true } } },
    orderBy: { doneAt: "desc" },
    take: 500,
  });
  const history = await db.workItemHistory.findMany({ where: { field: "status", workItemId: { in: items.map((i) => i.id) } }, select: { workItemId: true, newValue: true, changedAt: true } });
  const byItem = new Map<string, { newValue: string | null; changedAt: Date }[]>();
  for (const h of history) (byItem.get(h.workItemId) ?? byItem.set(h.workItemId, []).get(h.workItemId)!).push(h);

  const rows: Row[] = [];
  const totals: Record<string, number[]> = {};
  for (const i of items) {
    // Stories and bugs: Committed -> Done. Tasks: In Progress -> Done.
    const days = cycleTimeDays(byItem.get(i.id) ?? [], i.type === "TASK" ? "IN_PROGRESS" : "COMMITTED", i.createdAt);
    if (days == null) continue;
    (totals[i.type] ??= []).push(days);
    rows.push({ id: itemKey(i.lob.key, i.number), title: i.title, type: TYPE_LABEL[i.type], assignee: i.assignee?.name ?? "", done: toISODate(i.doneAt!), days });
  }
  const avg = (t: string) => (totals[t]?.length ? `${r1(totals[t].reduce((x, y) => x + y, 0) / totals[t].length)} days (${totals[t].length})` : "n/a");
  return {
    id: "cycle",
    title: "Cycle time",
    description: `Days from Committed to Done (stories and bugs) or In Progress to Done (tasks). Items finished ${since ? `since ${formatDate(since)}` : "in the selected sprints"}${to ? ` until ${formatDate(to)}` : ""}. Average — stories: ${avg("STORY")}, bugs: ${avg("BUG")}, tasks: ${avg("TASK")}. If an item skipped the start status, the days run from when it was created.`,
    columns: [{ key: "id", label: "ID" }, { key: "title", label: "Title" }, { key: "type", label: "Type" }, { key: "assignee", label: "Assignee" }, { key: "done", label: "Done on" }, { key: "days", label: "Cycle days", numeric: true }],
    rows,
  };
}
