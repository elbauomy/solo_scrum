import Link from "next/link";
import { requirePageAccess } from "@/lib/auth";
import { RoleProvider } from "@/components/role-provider";
import { loadDailyPlan, DAY_OPTIONS, type DailyFilters } from "@/lib/daily-plan-data";
import type { DayCell, DayItem } from "@/lib/daily-plan";
import { addDays, formatDate, startOfWeek, toISODate, WEEKDAYS_SHORT } from "@/lib/dates";
import { applyCls, selectCls, toQuery } from "@/lib/filters";
import { TimelineTabs } from "@/components/timeline-tabs";
import { Card, Empty, PageHeader, cn } from "@/components/ui";

const OFF_LABEL = { weekend: "Weekend", holiday: "Holiday", leave: "On leave" } as const;

function Item({ i }: { i: DayItem }) {
  const part = i.totalHours != null && !i.done && i.hours < i.totalHours - 0.01 ? ` of ${i.totalHours}h` : "";
  return (
    <li className="flex items-start gap-1.5">
      <span
        className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", i.done ? "bg-green-500" : i.status === "IN_PROGRESS" ? "bg-amber-500" : "bg-slate-300")}
        title={i.done ? "Finished this day" : i.status === "IN_PROGRESS" ? "In progress" : "Planned"}
      />
      <span className="min-w-0">
        <Link href={`/items/${i.id}`} className={cn("hover:underline", i.done && "text-slate-400 line-through")}>
          <span className="font-mono text-[11px] text-slate-500">{i.key}</span> {i.title}
        </Link>
        <span className="ml-1 whitespace-nowrap text-xs text-slate-500">{i.done ? (i.hours ? `${i.hours}h done` : "done") : `${i.hours}h${part}`}</span>
        {i.blocked && <span className="ml-1 rounded bg-red-100 px-1 text-[10px] font-semibold text-red-700">Blocked</span>}
      </span>
    </li>
  );
}

function Cell({ c, isToday }: { c: DayCell; isToday: boolean }) {
  if (c.off && c.stories.length === 0) {
    return <td className="min-w-48 border border-slate-100 bg-slate-100 p-2 align-top text-center text-xs text-slate-400">{OFF_LABEL[c.off]}</td>;
  }
  return (
    <td className={cn("min-w-52 border border-slate-100 p-2 align-top text-sm", isToday && "bg-orange-50/40", c.off && "bg-slate-50")}>
      {c.off && <div className="mb-1 text-[11px] font-medium uppercase text-slate-400">{OFF_LABEL[c.off]}</div>}
      {c.stories.length === 0 ? (
        <span className="text-xs text-slate-300">No task planned</span>
      ) : (
        <div className="space-y-2">
          {c.stories.map((s) => (
            <div key={s.storyId ?? "none"}>
              <div className="truncate text-xs font-semibold text-slate-700" title={s.storyTitle}>
                {s.storyId ? (
                  <Link href={`/items/${s.storyId}`} className="hover:underline"><span className="font-mono text-[11px] font-normal text-slate-500">{s.storyKey}</span> {s.storyTitle}</Link>
                ) : (
                  "Tasks without a story"
                )}
              </div>
              <ul className="mt-0.5 space-y-0.5 border-l border-slate-200 pl-2">
                {s.items.map((i) => <Item key={i.id} i={i} />)}
              </ul>
            </div>
          ))}
          {c.hours > 0 && <div className="border-t border-slate-100 pt-1 text-right text-[11px] text-slate-500">{c.hours}h planned</div>}
        </div>
      )}
    </td>
  );
}

export default async function DailyPlanPage({ searchParams }: PageProps<"/timeline/daily">) {
  const me = await requirePageAccess("timeline.view");
  const f = (await searchParams) as DailyFilters;
  const { a, from, n, days, rows, pausedSprints } = await loadDailyPlan(f);
  const todayISO = toISODate(a.today);
  const keep = { squad: f.squad, lob: f.lob, member: f.member, sprint: f.sprint, release: f.release, all: f.all, showOff: f.showOff };
  const weekStart = startOfWeek(a.today, 0);
  const quick = [
    { label: "Today", q: toQuery({ ...keep, from: todayISO, days: "1" }) },
    { label: "This week", q: toQuery({ ...keep, from: toISODate(weekStart), days: "7" }) },
    { label: "Next 7 days", q: toQuery({ ...keep, from: todayISO, days: "7" }) },
    { label: "Next week", q: toQuery({ ...keep, from: toISODate(addDays(weekStart, 7)), days: "7" }) },
  ];

  return (
    <RoleProvider readOnly={!me.permissions.has("timeline.act")}>
    <>
      <PageHeader
        title="Timeline"
        description="What each team member works on every day: the user story and the tasks, planned from their hours and availability."
        actions={
          <div className="no-print">
            <a href={`/api/export/daily-plan${toQuery({ ...keep, from: toISODate(from), days: String(n) })}`} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Export Excel</a>
          </div>
        }
      />
      <TimelineTabs current="daily" filters={keep} />

      <Card className="no-print mb-4">
        <form className="flex flex-wrap items-end gap-2">
          <select name="squad" defaultValue={f.squad ?? ""} className={selectCls} aria-label="Squad">
            <option value="">All squads</option>
            {a.squads.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select name="lob" defaultValue={f.lob ?? ""} className={selectCls} aria-label="Line of Business">
            <option value="">All lines of business</option>
            {a.lobs.filter((l) => !f.squad || l.squadId === f.squad).map((l) => <option key={l.id} value={l.id}>{l.key} · {l.name}</option>)}
          </select>
          <select name="member" defaultValue={f.member ?? ""} className={selectCls} aria-label="Member">
            <option value="">All members</option>
            {a.members.filter((m) => m.active && (!f.squad || m.squadIds.includes(f.squad))).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <select name="sprint" defaultValue={f.sprint ?? ""} className={selectCls} aria-label="Sprint">
            <option value="">All sprints</option>
            {a.sprints.filter((s) => s.state !== "CLOSED" && (!f.squad || s.squadId === f.squad) && (!f.lob || s.lobId === f.lob)).map((s) => <option key={s.id} value={s.id}>{s.lobKey} · {s.name}</option>)}
          </select>
          <select name="release" defaultValue={f.release ?? ""} className={selectCls} aria-label="Release">
            <option value="">Any release</option>
            {a.releases.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <label className="flex items-center gap-1 text-xs text-slate-500">
            From <input type="date" name="from" defaultValue={toISODate(from)} className={selectCls} aria-label="From" />
          </label>
          <select name="days" defaultValue={String(n)} className={selectCls} aria-label="Number of days">
            {DAY_OPTIONS.map((d) => <option key={d} value={d}>{d === 1 ? "1 day" : `${d} days`}</option>)}
          </select>
          <label className="flex items-center gap-1 text-sm text-slate-700"><input type="checkbox" name="all" value="1" defaultChecked={f.all === "1"} /> Members with no work</label>
          <label className="flex items-center gap-1 text-sm text-slate-700"><input type="checkbox" name="showOff" value="1" defaultChecked={f.showOff === "1"} /> Weekends and holidays</label>
          <button className={applyCls}>Apply</button>
          <Link href="/timeline/daily" className="px-2 py-1.5 text-sm text-slate-500 hover:text-slate-800">Clear</Link>
        </form>
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          {quick.map((x) => <Link key={x.label} href={`/timeline/daily${x.q}`} className="rounded-md border border-slate-300 px-2.5 py-1 text-slate-700 hover:bg-slate-50">{x.label}</Link>)}
        </div>
      </Card>

      {pausedSprints.length > 0 && (
        <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Paused, so their tasks are not planned: {pausedSprints.map((s) => `${s.lobKey} ${s.name}`).join(", ")}.
        </p>
      )}

      <Card title={`${formatDate(days[0])}${days.length > 1 ? ` – ${formatDate(days[days.length - 1])}` : ""} · ${rows.length} member(s)`}>
        {rows.length === 0 ? (
          <Empty>No work is planned in this period. Assign tasks to members, give them hours, and plan their stories into a sprint.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="border-collapse text-left" aria-label="Daily plan">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 min-w-36 border border-slate-100 bg-white px-2 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Member</th>
                  {days.map((d) => {
                    const iso = toISODate(d);
                    return (
                      <th key={iso} className={cn("border border-slate-100 px-2 py-2 text-xs font-semibold", iso === todayISO ? "bg-orange-100 text-orange-800" : "bg-slate-50 text-slate-600")}>
                        {WEEKDAYS_SHORT[d.getUTCDay()]} {formatDate(d).slice(0, 6)}{iso === todayISO && " · today"}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.memberId}>
                    <th className="sticky left-0 z-10 border border-slate-100 bg-white px-2 py-2 align-top text-sm font-medium text-slate-800">
                      {r.name}
                      <div className="text-xs font-normal text-slate-500">{r.hours}h · {r.taskCount} task(s)</div>
                    </th>
                    {r.days.map((c) => <Cell key={c.iso} c={c} isToday={c.iso === todayISO} />)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-slate-500">
          Each day lists the user story and, under it, the tasks planned for that person with the hours for that day. Dates come from each task&apos;s hours and the person&apos;s availability, in sprint, story and task order.
          Grey dot = planned, amber = in progress, green = finished that day.
        </p>
      </Card>
    </>
    </RoleProvider>
  );
}
