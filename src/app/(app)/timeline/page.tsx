import Link from "next/link";
import { requirePageAccess } from "@/lib/auth";
import { RoleProvider } from "@/components/role-provider";
import { loadAnalytics, type TaskView } from "@/lib/analytics";
import { filterTimeline } from "@/lib/timeline-filter";
import { TimelineTabs } from "@/components/timeline-tabs";
import { addDays, eachDay, formatDate, startOfWeek, toISODate, WEEKDAYS_SHORT } from "@/lib/dates";
import { applyCls, dateParam, selectCls, toQuery } from "@/lib/filters";
import { isWorkingDay } from "@/lib/capacity";
import { daysBetween } from "@/lib/planning";
import { AssigneeSelect, EstimateInput, NextSprintButton } from "@/components/item-actions";
import { AcceptBaselineForm, ResetBaselineForm } from "@/components/accept-baseline";
import { LoadBar, fmtH } from "@/components/sprint-ui";
import { Badge, Card, Empty, PageHeader, Table, Td, Th, cn } from "@/components/ui";

type Q = { squad?: string; lob?: string; member?: string; sprint?: string; release?: string; from?: string; to?: string; zoom?: string; only?: string };

function status(t: TaskView) {
  if (t.sprintPaused) return <Badge tone="amber">Sprint paused</Badge>;
  if (t.issue === "unassigned") return <Badge tone="amber">Unassigned</Badge>;
  if (t.issue === "no-estimate") return <Badge tone="amber">Needs estimate</Badge>;
  if (t.issue === "no-availability") return <Badge tone="red">No availability</Badge>;
  if (!t.plan?.end) return <Badge>Not scheduled</Badge>;
  if (t.slipped) return <Badge tone="red">Slips {daysBetween(t.deadline, t.plan.end)} day(s)</Badge>;
  return <Badge tone="green">On track</Badge>;
}

export default async function TimelinePage({ searchParams }: PageProps<"/timeline">) {
  const me = await requirePageAccess("timeline.view");
  const f = (await searchParams) as Q;
  const a = await loadAnalytics();
  const zoom = f.zoom === "week" ? "week" : "day";
  const from = dateParam(f.from) ?? (zoom === "week" ? startOfWeek(a.today, 0) : a.today);
  const maxDays = zoom === "week" ? 26 * 7 : 42;
  const requestedTo = dateParam(f.to) ?? addDays(from, zoom === "week" ? 12 * 7 - 1 : 27);
  const to = requestedTo.getTime() - from.getTime() > (maxDays - 1) * 86400000 ? addDays(from, maxDays - 1) : requestedTo < from ? addDays(from, 27) : requestedTo;

  const { tasks, overloadRows } = filterTimeline(a, f);

  // Grid: member rows x day (or week) columns
  const days = eachDay(from, to);
  const columns: { key: string; label: string; sub: string; days: Date[]; working: boolean }[] =
    zoom === "day"
      ? days.map((d) => ({ key: toISODate(d), label: String(d.getUTCDate()), sub: WEEKDAYS_SHORT[d.getUTCDay()], days: [d], working: isWorkingDay(d, a.cal) }))
      : (() => {
          const out: { key: string; label: string; sub: string; days: Date[]; working: boolean }[] = [];
          for (const d of days) {
            const ws = startOfWeek(d, 0);
            const key = toISODate(ws);
            const last = out[out.length - 1];
            if (last && last.key === key) last.days.push(d);
            else out.push({ key, label: formatDate(ws).slice(0, 6), sub: "week", days: [d], working: true });
          }
          return out;
        })();
  const byMember = new Map<string, { name: string; tasks: TaskView[] }>();
  for (const t of tasks) {
    if (!t.assigneeId || !t.plan) continue;
    const row = byMember.get(t.assigneeId) ?? { name: t.assigneeName ?? "", tasks: [] };
    row.tasks.push(t);
    byMember.set(t.assigneeId, row);
  }
  const memberRows = [...byMember.entries()].sort((x, y) => x[1].name.localeCompare(y[1].name));
  const cellHours = (list: TaskView[], ds: Date[]) => {
    const names: string[] = [];
    let h = 0;
    for (const t of list) {
      const th = ds.reduce((s, d) => s + (t.plan?.byDay[toISODate(d)] ?? 0), 0);
      if (th > 0) {
        h += th;
        names.push(`${t.key} ${t.title} (${Math.round(th * 100) / 100}h)`);
      }
    }
    return { h: Math.round(h * 100) / 100, names };
  };

  const slippedIds = tasks.filter((t) => t.slipped && t.plan?.end).map((t) => t.id);
  const keep = { squad: f.squad, lob: f.lob, member: f.member, sprint: f.sprint, release: f.release, only: f.only, from: f.from, to: f.to };
  const exportQuery = toQuery({ ...keep, zoom });

  return (
    <RoleProvider readOnly={!me.permissions.has("timeline.act")}>
    <>
      <PageHeader
        title="Timeline"
        description="Planned dates built from each member's availability and task hours. Nothing moves until you decide."
        actions={<a href={`/api/export/timeline${exportQuery}`} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Export Excel</a>}
      />

      <TimelineTabs current="hours" filters={{ squad: f.squad, lob: f.lob, member: f.member, sprint: f.sprint, release: f.release }} />
      <Card className="mb-4">
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
            <option value="">All open sprints</option>
            {a.sprints.filter((s) => s.state !== "CLOSED" && (!f.squad || s.squadId === f.squad) && (!f.lob || s.lobId === f.lob)).map((s) => <option key={s.id} value={s.id}>{s.lobKey} · {s.name}</option>)}
          </select>
          <select name="release" defaultValue={f.release ?? ""} className={selectCls} aria-label="Release">
            <option value="">Any release</option>
            {a.releases.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <select name="only" defaultValue={f.only ?? ""} className={selectCls} aria-label="Show">
            <option value="">All tasks</option>
            <option value="slipped">Only slipped / problems</option>
            <option value="overloaded">Only overloaded members</option>
          </select>
          <label className="flex items-center gap-1 text-xs text-slate-500">
            <input type="date" name="from" defaultValue={toISODate(from)} className={selectCls} aria-label="From" /> –
            <input type="date" name="to" defaultValue={toISODate(to)} className={selectCls} aria-label="To" />
          </label>
          <select name="zoom" defaultValue={zoom} className={selectCls} aria-label="Zoom">
            <option value="day">By day</option>
            <option value="week">By week</option>
          </select>
          <button className={applyCls}>Apply</button>
          <Link href="/timeline" className="px-2 py-1.5 text-sm text-slate-500 hover:text-slate-800">Clear</Link>
        </form>
      </Card>

      {overloadRows.length > 0 && (
        <Card title={`Overloaded members (${overloadRows.length})`} className="mb-4">
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {overloadRows.map((o) => (
              <li key={`${o.sprintId}${o.memberId}`} className="flex items-center justify-between gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm">
                <span><strong>{o.name}</strong> <Link href={`/sprints/${o.sprintId}`} className="text-xs text-slate-500 hover:underline">{o.sprintName}</Link></span>
                <LoadBar assigned={o.assigned} capacity={o.capacity} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Scheduled hours per member" className="mb-4">
        {memberRows.length === 0 ? (
          <Empty>No scheduled tasks. Plan stories into a sprint, assign tasks to members and give them hour estimates.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="border-separate border-spacing-0.5 text-xs" aria-label="Scheduled hours per member">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 min-w-36 bg-white px-2 py-1 text-left font-semibold text-slate-600">Member</th>
                  {columns.map((c) => (
                    <th key={c.key} className={cn("min-w-9 rounded px-1 py-1 text-center font-medium", c.working ? "bg-slate-100 text-slate-700" : "bg-slate-200 text-slate-400")}>
                      <div>{c.label}</div>
                      <div className="text-[10px] font-normal">{c.sub}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {memberRows.map(([mid, row]) => (
                  <tr key={mid}>
                    <th className="sticky left-0 z-10 bg-white px-2 py-1 text-left font-medium text-slate-800">{row.name}</th>
                    {columns.map((c) => {
                      const cell = cellHours(row.tasks, c.days);
                      const alpha = Math.min(1, cell.h / (zoom === "week" ? 32 : 8));
                      return (
                        <td
                          key={c.key}
                          title={cell.names.join("\n") || undefined}
                          className={cn("h-8 min-w-9 rounded text-center", !c.working && "bg-slate-100", cell.h > 0 && "font-medium text-slate-900")}
                          style={cell.h > 0 ? { backgroundColor: `rgba(234, 88, 12, ${0.15 + alpha * 0.55})` } : undefined}
                        >
                          {cell.h > 0 ? cell.h : ""}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-slate-500">Hours planned per {zoom}. Darker means busier. Greyed days are weekends or holidays. Hover a cell to see the tasks.</p>
      </Card>

      <Card
        title={`Tasks (${tasks.length})`}
        actions={slippedIds.length > 0 ? <AcceptBaselineForm taskIds={slippedIds} label={`Accept all ${slippedIds.length} new date(s)`} /> : undefined}
      >
        {tasks.length === 0 ? (
          <Empty>No open tasks in planned or active sprints match these filters.</Empty>
        ) : (
          <Table>
            <thead>
              <tr><Th>Task</Th><Th>Sprint</Th><Th>Assignee</Th><Th>Hours</Th><Th>Planned</Th><Th>Deadline</Th><Th>Status</Th><Th>Your action</Th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tasks.map((t) => {
                const options = a.members.filter((m) => m.active && m.squadIds.includes(t.squadId)).map((m) => ({ id: m.id, name: m.name }));
                const problem = t.slipped || t.issue != null;
                return (
                  <tr key={t.id} className={problem ? "bg-red-50/40" : undefined}>
                    <Td>
                      <Link href={`/items/${t.id}`} className="font-mono text-xs text-slate-500 hover:underline">{t.key}</Link>{" "}
                      <Link href={`/items/${t.id}`} className="hover:underline">{t.title}</Link>
                      {t.storyKey && <div className="text-xs text-slate-400">{t.storyKey} {t.storyTitle}</div>}
                      {t.blocked && <Badge tone="red">Blocked</Badge>}
                    </Td>
                    <Td className="text-xs"><Link href={`/sprints/${t.sprintId}`} className="hover:underline">{t.sprintName}</Link><div className="text-slate-400">ends {formatDate(t.sprintEnd)}</div></Td>
                    <Td><AssigneeSelect taskId={t.id} value={t.assigneeId ?? ""} options={options} /></Td>
                    <Td><EstimateInput taskId={t.id} value={t.hours} /></Td>
                    <Td className="whitespace-nowrap text-xs">{t.plan?.start && t.plan.end ? `${formatDate(t.plan.start)} → ${formatDate(t.plan.end)}` : "—"}</Td>
                    <Td className="whitespace-nowrap text-xs">
                      {formatDate(t.deadline)}
                      {t.baselineEnd && <div className="text-slate-400">baseline</div>}
                    </Td>
                    <Td>{status(t)}</Td>
                    <Td>
                      <div className="flex flex-wrap items-center gap-1">
                        {t.slipped && t.plan?.end && <AcceptBaselineForm taskIds={[t.id]} label="Accept new date" />}
                        {t.slipped && <NextSprintButton itemId={t.id} />}
                        {t.baselineEnd && <ResetBaselineForm id={t.id} />}
                        {t.slipped && <span className="text-[11px] text-slate-400">or reassign / re-estimate</span>}
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
        <p className="mt-3 text-xs text-slate-500">
          Tasks are scheduled in sprint, story and task order, using only the assignee&apos;s available hours (no dependencies). A task slips when it would finish after its deadline: the sprint end, or the baseline you accepted earlier.
          Choose what to do: reassign, change the estimate, move the story to the next sprint, or accept the new date as the baseline.
        </p>
      </Card>
      <p className="mt-2 text-xs text-slate-400">Showing {formatDate(from)} – {formatDate(to)} · total scheduled {fmtH(tasks.reduce((s, t) => s + (t.plan ? Object.values(t.plan.byDay).reduce((x, y) => x + y, 0) : 0), 0))}</p>
    </>
    </RoleProvider>
  );
}
