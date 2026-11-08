import Link from "next/link";
import { requirePageAccess } from "@/lib/auth";
import { REPORTS, buildReports, type ReportFilters } from "@/lib/reports";
import { applyCls, selectCls, toQuery } from "@/lib/filters";
import { formatDate } from "@/lib/dates";
import { BurndownChart, GroupedBars } from "@/components/charts";
import { PrintButton } from "@/components/print-button";
import { ReportTableView } from "@/components/report-table";
import { Card, Empty, PageHeader, tabClass } from "@/components/ui";

type Q = ReportFilters & { report?: string };

export default async function ReportsPage({ searchParams }: PageProps<"/reports">) {
  const me = await requirePageAccess("reports.view");
  const canExport = me.permissions.has("reports.export");
  const f = (await searchParams) as Q;
  const report = REPORTS.some((r) => r.id === f.report) ? f.report! : "health";
  const b = await buildReports(f);
  const table = b.tables[report];
  const { a } = b;
  const filters: ReportFilters = { squad: f.squad, lob: f.lob, sprint: f.sprint, last: f.last, from: f.from, to: f.to, member: f.member, release: f.release, type: f.type };
  const query = (extra: Record<string, string | undefined>) => toQuery({ ...filters, ...extra });
  const scope = [
    f.squad && a.squads.find((s) => s.id === f.squad)?.name,
    f.lob && a.lobs.find((l) => l.id === f.lob)?.name,
    f.member && a.members.find((m) => m.id === f.member)?.name,
    f.release && a.releases.find((r) => r.id === f.release)?.name,
    f.from || f.to ? `${f.from ?? "…"} to ${f.to ?? "…"}` : null,
  ].filter(Boolean).join(" · ");

  return (
    <>
      <PageHeader
        title="Reports"
        description={`${b.sprints.length} sprint(s) included${scope ? ` · ${scope}` : ""} · generated ${formatDate(a.today)}`}
        actions={
          <div className="no-print flex flex-wrap gap-2">
            {canExport && <a href={`/api/export/report${query({ report })}`} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Export this report (Excel)</a>}
            {canExport && <a href={`/api/export/report${query({ report: "all" })}`} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Export all (Excel)</a>}
            <PrintButton />
          </div>
        }
      />

      <Card className="no-print mb-4">
        <form className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="report" value={report} />
          <select name="squad" defaultValue={f.squad ?? ""} className={selectCls} aria-label="Squad">
            <option value="">All squads</option>
            {a.squads.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select name="lob" defaultValue={f.lob ?? ""} className={selectCls} aria-label="Line of Business">
            <option value="">All lines of business</option>
            {a.lobs.filter((l) => !f.squad || l.squadId === f.squad).map((l) => <option key={l.id} value={l.id}>{l.key} · {l.name}</option>)}
          </select>
          <select name="sprint" defaultValue={f.sprint ?? ""} className={selectCls} aria-label="Sprint">
            <option value="">Last N sprints…</option>
            {a.sprints.filter((s) => (!f.squad || s.squadId === f.squad) && (!f.lob || s.lobId === f.lob)).slice().reverse().map((s) => <option key={s.id} value={s.id}>{s.lobKey} · {s.name}</option>)}
          </select>
          <label className="flex items-center gap-1 text-xs text-slate-500">
            Last
            <input type="number" name="last" min="1" max="52" defaultValue={f.last ?? "6"} className={`${selectCls} w-16`} aria-label="Number of sprints" />
            sprints
          </label>
          <label className="flex items-center gap-1 text-xs text-slate-500">
            <input type="date" name="from" defaultValue={f.from} className={selectCls} aria-label="From" /> –
            <input type="date" name="to" defaultValue={f.to} className={selectCls} aria-label="To" />
          </label>
          <select name="member" defaultValue={f.member ?? ""} className={selectCls} aria-label="Member">
            <option value="">All members</option>
            {a.members.filter((m) => !f.squad || m.squadIds.includes(f.squad)).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <select name="release" defaultValue={f.release ?? ""} className={selectCls} aria-label="Release">
            <option value="">Any release</option>
            {a.releases.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <select name="type" defaultValue={f.type ?? ""} className={selectCls} aria-label="Item type (cycle time)">
            <option value="">All item types</option>
            <option value="STORY">Stories</option>
            <option value="BUG">Bugs</option>
            <option value="TASK">Tasks</option>
          </select>
          <button className={applyCls}>Apply</button>
          <Link href={`/reports?report=${report}`} className="px-2 py-1.5 text-sm text-slate-500 hover:text-slate-800">Clear</Link>
        </form>
        <p className="mt-2 text-xs text-slate-500">Without a date range or a chosen sprint, each line of business shows its last N started sprints. Planned sprints are left out. The item type filter applies to cycle time.</p>
      </Card>

      <nav className="no-print mb-4 flex flex-wrap gap-1" aria-label="Reports">
        {REPORTS.map((r) => (
          <Link key={r.id} href={`/reports${query({ report: r.id })}`} className={tabClass(r.id === report)}>
            {r.label}
          </Link>
        ))}
      </nav>

      <Card title={table.title}>
        <p className="mb-4 text-sm text-slate-600">{table.description}</p>

        {report === "health" && b.sprints.length > 0 && (
          <div className="mb-4"><GroupedBars data={b.sprints.map((s) => ({ label: `${s.lobKey} ${s.name}`, score: s.summary.health.score }))} series={[{ key: "score", name: "Health score", color: "#ea580c" }]} height={240} /></div>
        )}
        {report === "velocity" && b.charts.velocity.length > 0 && (
          <div className="mb-4"><GroupedBars data={b.charts.velocity} series={[{ key: "committed", name: "Committed h", color: "#94a3b8" }, { key: "done", name: "Done h", color: "#ea580c" }, { key: "average", name: "Average of last 3 h", color: "#0284c7" }]} /></div>
        )}
        {report === "burndown" && (
          <>
            {b.burndownSprint ? (
              <div className="mb-4"><BurndownChart data={b.burndownSprint.summary.burndown} /></div>
            ) : (
              <Empty>No sprint to show. Start a sprint first.</Empty>
            )}
            {b.sprints.length > 1 && <p className="mb-3 text-xs text-slate-500">Showing one sprint. Pick another in the Sprint filter above.</p>}
          </>
        )}
        {report === "capacity" && b.charts.load.length > 0 && (
          <div className="mb-4">
            <GroupedBars data={b.charts.load} series={[{ key: "capacity", name: "Capacity h", color: "#94a3b8" }, { key: "assigned", name: "Assigned h", color: "#ea580c" }, { key: "done", name: "Done h", color: "#16a34a" }]} />
            <p className="mt-1 text-xs text-slate-500">Chart: {b.burndownSprint ? `${b.burndownSprint.lobKey} ${b.burndownSprint.name}` : "selected sprint"}. The table lists every selected sprint.</p>
          </div>
        )}
        {report === "productivity" && b.charts.productivity.length > 0 && (
          <div className="mb-4"><GroupedBars data={b.charts.productivity} series={[{ key: "productivity", name: "Productivity %", color: "#ea580c" }]} unit="%" height={240} /></div>
        )}
        {report === "quality" && b.charts.quality.length > 0 && (
          <div className="mb-4"><GroupedBars data={b.charts.quality} unit="%" series={[{ key: "reliability", name: "Reliability %", color: "#16a34a" }, { key: "scope", name: "Scope change %", color: "#ea580c" }, { key: "carry", name: "Carry-over %", color: "#0284c7" }]} /></div>
        )}

        <ReportTableView table={table} />
      </Card>
    </>
  );
}
