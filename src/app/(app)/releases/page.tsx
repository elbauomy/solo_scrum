import Link from "next/link";
import { requirePageAccess } from "@/lib/auth";
import { RoleProvider } from "@/components/role-provider";
import { loadAnalytics } from "@/lib/analytics";
import { createRelease } from "@/lib/actions/releases";
import { formatDate, toISODate, addDays } from "@/lib/dates";
import { applyCls, dateParam, selectCls } from "@/lib/filters";
import { ActionForm, SubmitButton } from "@/components/ui/forms";
import { fmtH } from "@/components/sprint-ui";
import { Card, Empty, Field, Input, PageHeader, Select, Table, Td, Textarea, Th } from "@/components/ui";
import { ReleaseStatus } from "@/components/release-status";
import { Can } from "@/components/edit-only";

type Q = { squad?: string; lob?: string; status?: string; from?: string; to?: string; q?: string };

export default async function ReleasesPage({ searchParams }: PageProps<"/releases">) {
  const me = await requirePageAccess("releases.view");
  const f = (await searchParams) as Q;
  const a = await loadAnalytics();
  const from = dateParam(f.from);
  const to = dateParam(f.to);
  const q = f.q?.trim().toLowerCase();
  const late = (r: (typeof a.releases)[number]) => !r.deployedDate && ((r.forecastDelayDays ?? 0) > 0 || r.targetDate < a.today);
  const releases = a.releases
    .filter((r) => (!f.squad || r.squadId === f.squad) && (!f.lob || r.lobId === f.lob))
    .filter((r) => !f.status || (f.status === "deployed" ? r.deployedDate : f.status === "planned" ? !r.deployedDate : f.status === "late" ? late(r) : true))
    .filter((r) => (!from || r.targetDate >= from) && (!to || r.targetDate <= to))
    .filter((r) => !q || r.name.toLowerCase().includes(q) || r.version.toLowerCase().includes(q))
    .sort((x, y) => x.targetDate.getTime() - y.targetDate.getTime());

  return (
    <RoleProvider readOnly={!me.permissions.has("releases.manage")}>
    <>
      <PageHeader title="Releases" description="A release is a deployment of one line of business. It contains several of that line's sprints." />

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
          <select name="status" defaultValue={f.status ?? ""} className={selectCls} aria-label="Status">
            <option value="">Any status</option>
            <option value="planned">Not deployed</option>
            <option value="late">Late / at risk</option>
            <option value="deployed">Deployed</option>
          </select>
          <label className="flex items-center gap-1 text-xs text-slate-500">
            Target between
            <input type="date" name="from" defaultValue={f.from} className={selectCls} aria-label="From" /> –
            <input type="date" name="to" defaultValue={f.to} className={selectCls} aria-label="To" />
          </label>
          <input name="q" defaultValue={f.q} placeholder="Name or version" className={`${selectCls} w-40`} aria-label="Search" />
          <button className={applyCls}>Apply</button>
          <Link href="/releases" className="px-2 py-1.5 text-sm text-slate-500 hover:text-slate-800">Clear</Link>
        </form>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <Card title={`Releases (${releases.length})`}>
          {releases.length === 0 ? (
            <Empty>No releases match these filters.</Empty>
          ) : (
            <Table>
              <thead>
                <tr><Th>Release</Th><Th>Line of Business</Th><Th>Target</Th><Th>Forecast</Th><Th>Sprints</Th><Th className="text-right">Remaining</Th><Th>Status</Th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {releases.map((r) => (
                  <tr key={r.id}>
                    <Td>
                      <Link href={`/releases/${r.id}`} className="font-medium text-orange-700 hover:underline">{r.name}</Link>
                      {r.version && <div className="text-xs text-slate-500">v{r.version}</div>}
                    </Td>
                    <Td><span className="font-mono text-xs text-slate-500">{r.lobKey}</span> {r.lobName}</Td>
                    <Td className="whitespace-nowrap">
                      {formatDate(r.targetDate)}
                      {r.changes.length > 0 && <div className="text-xs text-amber-700">moved {r.changes.length}×</div>}
                    </Td>
                    <Td className="whitespace-nowrap text-xs">{r.deployedDate ? `Deployed ${formatDate(r.deployedDate)}` : r.forecast ? formatDate(r.forecast) : <span className="text-slate-400">needs velocity</span>}</Td>
                    <Td>{r.sprintIds.length}</Td>
                    <Td className="text-right">{fmtH(r.remainingHours)}</Td>
                    <Td><ReleaseStatus release={r} today={a.today} /></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          <p className="mt-3 text-xs text-slate-500">Forecast = remaining hours of the release&apos;s open sprints ÷ the line&apos;s average velocity (last 3 closed sprints).</p>
        </Card>

        <Can perm="releases.manage">
        <Card title="New release">
          {a.lobs.length === 0 ? (
            <Empty>Create a line of business first.</Empty>
          ) : (
            <ActionForm action={createRelease} className="space-y-3" resetOnSuccess={false}>
              <Field label="Line of Business">
                <Select name="lobId" required defaultValue={f.lob ?? ""}>
                  <option value="">Choose…</option>
                  {a.lobs.map((l) => <option key={l.id} value={l.id}>{l.key} · {l.name}</option>)}
                </Select>
              </Field>
              <div className="grid grid-cols-[1fr_6rem] gap-3">
                <Field label="Name"><Input name="name" required maxLength={100} placeholder="e.g. November release" /></Field>
                <Field label="Version"><Input name="version" maxLength={50} placeholder="1.4" /></Field>
              </div>
              <Field label="Target deployment date"><Input type="date" name="targetDate" required defaultValue={toISODate(addDays(a.today, 30))} /></Field>
              <Field label="Notes"><Textarea name="notes" maxLength={1000} /></Field>
              <SubmitButton>Create release</SubmitButton>
            </ActionForm>
          )}
        </Card>
        </Can>
      </div>
    </>
    </RoleProvider>
  );
}
