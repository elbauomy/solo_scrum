// Daily plan: for each member and each day, which user stories and tasks they work on. Pure logic.
import type { WorkItemStatus } from "@/lib/enums";
import type { TaskView } from "./analytics";
import { isWorkingDay, type WorkCalendar } from "./capacity";
import { toISODate } from "./dates";

export type DoneTask = {
  id: string;
  key: string;
  title: string;
  assigneeId: string;
  doneAt: Date;
  hours: number | null;
  storyId: string | null;
  storyKey: string;
  storyTitle: string;
  sprintName: string;
};

export type DayItem = {
  id: string;
  key: string;
  title: string;
  /** Hours planned on this day (or the task's hours when it was finished on this day) */
  hours: number;
  /** The task's total estimate */
  totalHours: number | null;
  status: WorkItemStatus;
  blocked: boolean;
  done: boolean;
  sprintName: string;
};

export type DayStory = { storyId: string | null; storyKey: string; storyTitle: string; items: DayItem[]; hours: number };

export type DayCell = {
  iso: string;
  stories: DayStory[];
  /** Hours of planned (not yet done) work */
  hours: number;
  /** Why the member is not working that day */
  off: "weekend" | "holiday" | "leave" | null;
};

export type MemberDays = { memberId: string; name: string; days: DayCell[]; hours: number; taskCount: number };

const r2 = (n: number) => Math.round(n * 100) / 100;

export function offReason(day: Date, cal: WorkCalendar, leaves: { start: Date; end: Date }[] = []): DayCell["off"] {
  if (!cal.workingDays.includes(day.getUTCDay())) return "weekend";
  if (cal.holidays.has(toISODate(day))) return "holiday";
  if (leaves.some((l) => l.start.getTime() <= day.getTime() && day.getTime() <= l.end.getTime())) return "leave";
  return null;
}

/**
 * Group the planned tasks (and the tasks finished that day) by member, day and user story.
 * Members without any work in the range are left out unless they are in `includeMembers`.
 */
export function buildDailyPlan(args: {
  tasks: TaskView[];
  doneTasks: DoneTask[];
  days: Date[];
  cal: WorkCalendar;
  leaves: Record<string, { start: Date; end: Date }[]>;
  members: { id: string; name: string }[];
  includeMembers?: string[];
}): MemberDays[] {
  const { tasks, doneTasks, days, cal, leaves, members } = args;
  const keys = days.map((d) => toISODate(d));
  const rows: MemberDays[] = [];
  for (const m of members) {
    const mine = tasks.filter((t) => t.assigneeId === m.id && t.plan).sort((a, b) => a.order - b.order);
    const finished = doneTasks.filter((t) => t.assigneeId === m.id);
    const cells: DayCell[] = days.map((d, i) => {
      const iso = keys[i];
      const groups = new Map<string, DayStory>();
      const add = (storyId: string | null, storyKey: string, storyTitle: string, item: DayItem) => {
        const gk = storyId ?? "none";
        const g = groups.get(gk) ?? { storyId, storyKey, storyTitle, items: [], hours: 0 };
        g.items.push(item);
        if (!item.done) g.hours = r2(g.hours + item.hours);
        groups.set(gk, g);
      };
      for (const t of finished.filter((f) => toISODate(f.doneAt) === iso)) {
        add(t.storyId, t.storyKey, t.storyTitle, { id: t.id, key: t.key, title: t.title, hours: t.hours ?? 0, totalHours: t.hours, status: "DONE", blocked: false, done: true, sprintName: t.sprintName });
      }
      for (const t of mine) {
        const h = t.plan!.byDay[iso] ?? 0;
        if (h <= 0) continue;
        add(t.storyId, t.storyKey, t.storyTitle, { id: t.id, key: t.key, title: t.title, hours: r2(h), totalHours: t.hours, status: t.status, blocked: t.blocked, done: false, sprintName: t.sprintName });
      }
      const stories = [...groups.values()];
      return { iso, stories, hours: r2(stories.reduce((s, g) => s + g.hours, 0)), off: offReason(d, cal, leaves[m.id]) };
    });
    const taskCount = new Set(cells.flatMap((c) => c.stories.flatMap((s) => s.items.map((i) => i.id)))).size;
    if (taskCount === 0 && !args.includeMembers?.includes(m.id)) continue;
    rows.push({ memberId: m.id, name: m.name, days: cells, hours: r2(cells.reduce((s, c) => s + c.hours, 0)), taskCount });
  }
  return rows;
}

/** Days of the range that are working days for the whole calendar (weekends and holidays dropped). */
export function workingColumns(days: Date[], cal: WorkCalendar): Date[] {
  return days.filter((d) => isWorkingDay(d, cal));
}
