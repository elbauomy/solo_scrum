import Link from "next/link";
import { requirePageAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { loadAnalytics } from "@/lib/analytics";
import { getWorkCalendar } from "@/lib/settings";
import { capacityBetween } from "@/lib/capacity";
import { addDays, formatDate, startOfWeek, toISODate } from "@/lib/dates";
import { applyCls, dateParam, selectCls } from "@/lib/filters";
import { itemKey } from "@/lib/work-items";
import { ReleaseStatus } from "@/components/release-status";
import { HealthBadge, HealthParts, LoadBar, SprintStateBadge, fmtH } from "@/components/sprint-ui";
import { Badge, Card, Empty, PageHeader, Stat, Table, Td, Th } from "@/components/ui";

type Q = { squad?: string; lob?: string; sprint?: string; release?: string; from?: string; to?: string };

export default async function DashboardPage({ searchParams }: PageProps<"/">) {
  await requirePageAccess("dashboard.view");
  const f = (await searchParams) as Q;
  const [a, cal, blockedRows, squadRows] = await Promise.all([
    loadAnalytics(),
    getWorkCalendar(),
    db.workItem.findMany({
      where: { blocked: true, status: { not: "DONE" }, ...(f.lob ? { lobId: f.lob } : {}), ...(f.squad ? { lob: { squadId: f.squad } } : {}) },
      include: { lob: { select: { key: true, name: true } }, assignee: { select: { name: true } } },
      orderBy: { updatedAt: "desc" },
      take: 15,
    }),
    db.squad.findMany({
      orderBy: { name: "asc" },
      include: { lobs: { select: { id: true } }, memberships: { include: { member: { include: { leaves: true } } } } },
    }),
  ]);
  const from = dateParam(f.from);
  const to = dateParam(f.to);
  const inScope = (s: (typeof a.sprints)[number]) =>
    (!f.squad || s.squadId === f.squad) && (!f.lob || s.lobId === f.lob) && (!f.release || s.releaseId === f.release) && (!f.sprint || s.id === f.sprint) && (!from || s.end >= from) && (!to || s.start <= to);
  const scoped = a.sprints.filter(inScope);
  const active = scoped.filter((s) => s.state === "ACTIVE" || s.state === "PAUSED" || (f.sprint && s.id === f.sprint && s.state !== "PLANNED"));
  const pausedCount = active.filter((s) => s.state === "PAUSED").length;
  const releases = a.releases.filter((r) => (!f.squad || r.squadId === f.squad) && (!f.lob || r.lobId === f.lob) && (!f.release || r.id === f.release) && !r.deployedDate && (!from || r.targetDate >= from) && (!to || r.targetDate <= to));
  const memberName = new Map(a.members.map((m) => [m.id, m.name]));
  const overloaded = scoped
    .filter((s) => s.state !== "CLOSED")
    .flatMap((s) =>
      Object.entries(s.summary.byMember)
        .filter(([mid, v]) => v.assigned > (s.summary.capacityByMember[mid] ?? 0) + 0.01)
        .map(([mid, v]) => ({ sprint: s, name: memberName.get(mid) ?? "Removed member", assigned: v.assigned, capacity: s.summary.capacityByMember[mid] ?? 0 })),
    );
  const slipped = a.tasks.filter((t) => t.slipped && (!f.squad || t.squadId === f.squad) && (!f.lob || t.lobId === f.lob) && (!f.sprint || t.sprintId === f.sprint)).length;
  const avgHealth = active.length ? Math.round(active.reduce((s, x) => s + x.summary.health.score, 0) / active.length) : null;
  const lateReleases = releases.filter((r) => r.targetDate < a.today || (r.forecastDelayDays ?? 0) > 0).length;

  // Capacity this week per squad
  const weekStart = startOfWeek(a.today, 0);
  const weekEnd = addDays(weekStart, 6);
  const capRows = squadRows
    .filter((s) => !f.squad || s.id === f.squad)
    .map((s) => {
      const act = s.memberships.filter((m) => m.member.active);
      return {
        squad: s,
        members: act.length,
        lobs: s.lobs.length,
        nominal: act.reduce((sum, m) => sum + m.weeklyHours, 0),
        capacity: act.reduce((sum, m) => sum + capacityBetween(weekStart, weekEnd, m.weeklyHours, cal, m.member.leaves), 0),
        onLeave: act.filter((m) => m.member.leaves.some((l) => l.startDate <= weekEnd && l.endDate >= weekStart)).length,
      };
    });

  return (
    <>
      <PageHeader title="Dashboard" description={`Today ${formatDate(a.today)}`} />

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
          <select name="sprint" defaultValue={f.sprint ?? ""} className={selectCls} aria-label="Sprint">
            <option value="">Active sprints</option>
            {a.sprints.filter((s) => s.state !== "PLANNED" && (!f.squad || s.squadId === f.squad) && (!f.lob || s.lobId === f.lob)).slice().reverse().map((s) => <option key={s.id} value={s.id}>{s.lobKey} · {s.name}</option>)}
          </select>
          <select name="release" defaultValue={f.release ?? ""} className={selectCls} aria-label="Release">
            <option value="">Any release</option>
            {a.releases.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <label className="flex items-center gap-1 text-xs text-slate-500">
            <input type="date" name="from" defaultValue={f.from} className={selectCls} aria-label="From" /> –
            <input type="date" name="to" defaultValue={f.to} className={selectCls} aria-label="To" />
          </label>
          <button className={applyCls}>Apply</button>
          <Link href="/" className="px-2 py-1.5 text-sm text-slate-500 hover:text-slate-800">Clear</Link>
        </form>
      </Card>

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat label="Active sprints" value={active.length - pausedCount} hint={pausedCount ? `${pausedCount} paused` : undefined} />
        <Stat label="Average health" value={avgHealth ?? "—"} hint={avgHealth == null ? "No active sprint" : avgHealth >= 80 ? "Healthy" : avgHealth >= 60 ? "Watch" : "Needs action"} />
        <Stat label="Overloaded members" value={overloaded.length} hint="Assigned more than capacity" />
        <Stat label="Blocked items" value={blockedRows.length} hint={`${slipped} task(s) slipping`} />
        <Stat label="Releases at risk" value={lateReleases} hint={`of ${releases.length} not deployed`} />
      </div>

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Sprint health</h2>
      {active.length === 0 ? (
        <Card className="mb-6"><Empty>No active sprints{f.sprint || f.from || f.to ? " for these filters" : ""}. <Link href="/sprints" className="text-orange-700 underline">Plan a sprint</Link>.</Empty></Card>
      ) : (
        <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {active.map((s) => {
            const sum = s.summary;
            const daysLeft = Math.max(0, Math.round((s.end.getTime() - a.today.getTime()) / 86400000));
            return (
              <Card key={s.id} title={`${s.lobKey} · ${s.name}`} actions={<HealthBadge health={sum.health} />}>
                <div className="mb-3 flex items-center justify-between text-xs text-slate-500">
                  <span>{s.squadName}</span>
                  <span><SprintStateBadge state={s.state} /> {s.state === "ACTIVE" ? `${daysLeft} day(s) left` : s.state === "PAUSED" ? `since ${formatDate(s.pauses.find((p) => !p.resumedOn)?.start ?? s.start)}` : "ended"}</span>
                </div>
                <div className="mb-3 grid grid-cols-3 gap-2 text-center text-sm">
                  <div><div className="font-semibold text-slate-900">{fmtH(sum.doneHours)}</div><div className="text-[11px] text-slate-500">done</div></div>
                  <div><div className="font-semibold text-slate-900">{fmtH(sum.remainingHours)}</div><div className="text-[11px] text-slate-500">remaining</div></div>
                  <div><div className="font-semibold text-slate-900">{fmtH(sum.committedHours)}</div><div className="text-[11px] text-slate-500">committed</div></div>
                </div>
                <HealthParts parts={sum.health.parts} />
                <Link href={`/sprints/${s.id}`} className="mt-3 inline-block text-xs text-orange-700 hover:underline">Open sprint →</Link>
              </Card>
            );
          })}
        </div>
      )}

      <div className="mb-6 grid gap-6 xl:grid-cols-2">
        <Card title={`Release forecast (${releases.length})`}>
          {releases.length === 0 ? (
            <Empty>No upcoming releases.</Empty>
          ) : (
            <Table>
              <thead><tr><Th>Release</Th><Th>Target</Th><Th>Forecast</Th><Th>Status</Th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {releases.map((r) => (
                  <tr key={r.id}>
                    <Td><Link href={`/releases/${r.id}`} className="font-medium text-orange-700 hover:underline">{r.name}</Link><div className="text-xs text-slate-500">{r.lobKey}</div></Td>
                    <Td className="whitespace-nowrap">{formatDate(r.targetDate)}</Td>
                    <Td className="whitespace-nowrap text-xs">{r.forecast ? formatDate(r.forecast) : "—"}</Td>
                    <Td><ReleaseStatus release={r} today={a.today} /></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card title={`Overloaded members (${overloaded.length})`}>
          {overloaded.length === 0 ? (
            <Empty>Nobody is over capacity.</Empty>
          ) : (
            <ul className="space-y-2">
              {overloaded.map((o) => (
                <li key={`${o.sprint.id}${o.name}`} className="flex items-center justify-between gap-2 text-sm">
                  <span><strong>{o.name}</strong> <Link href={`/sprints/${o.sprint.id}`} className="text-xs text-slate-500 hover:underline">{o.sprint.lobKey} {o.sprint.name}</Link></span>
                  <LoadBar assigned={o.assigned} capacity={o.capacity} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title={`Blocked items (${blockedRows.length})`} className="mb-6">
        {blockedRows.length === 0 ? (
          <Empty>Nothing is blocked.</Empty>
        ) : (
          <Table>
            <thead><tr><Th>Item</Th><Th>Assignee</Th><Th>Reason</Th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {blockedRows.map((i) => (
                <tr key={i.id}>
                  <Td><Link href={`/items/${i.id}`} className="font-mono text-xs text-slate-500 hover:underline">{itemKey(i.lob.key, i.number)}</Link> <Link href={`/items/${i.id}`} className="hover:underline">{i.title}</Link></Td>
                  <Td>{i.assignee?.name ?? "—"}</Td>
                  <Td>{i.blockedReason ? i.blockedReason : <Badge tone="red">Blocked</Badge>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card title={`Squad capacity this week (${formatDate(weekStart)} – ${formatDate(weekEnd)})`}>
        {capRows.length === 0 ? (
          <Empty>No squads yet. <Link className="text-orange-700 underline" href="/squads">Create your first squad</Link>.</Empty>
        ) : (
          <Table>
            <thead><tr><Th>Squad</Th><Th>LOBs</Th><Th>Members</Th><Th>On leave</Th><Th>Weekly hours</Th><Th>Available this week</Th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {capRows.map((r) => (
                <tr key={r.squad.id}>
                  <Td><Link className="font-medium text-orange-700 hover:underline" href={`/squads/${r.squad.id}`}>{r.squad.name}</Link></Td>
                  <Td>{r.lobs}</Td>
                  <Td>{r.members}</Td>
                  <Td>{r.onLeave}</Td>
                  <Td>{r.nominal.toFixed(1)} h</Td>
                  <Td className="font-medium">{r.capacity.toFixed(1)} h</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <p className="mt-4 text-xs text-slate-400">Sprint data as of {toISODate(a.today)}.</p>
    </>
  );
}
