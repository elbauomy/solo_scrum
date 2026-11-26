import Link from "next/link";
import { requirePageAccess, can } from "@/lib/auth";
import { RoleProvider } from "@/components/role-provider";
import { loadAnalytics, sprintLengthFor } from "@/lib/analytics";
import { formatDate, toISODate } from "@/lib/dates";
import { applyCls, dateParam, selectCls } from "@/lib/filters";
import { NewSprintForm } from "@/components/new-sprint-form";
import { BulkDeleteBar } from "@/components/bulk-delete";
import { deleteSprints } from "@/lib/actions/sprints";
import { HealthBadge, SprintStateBadge, fmtH } from "@/components/sprint-ui";
import { Card, Empty, LinkButton, PageHeader, Table, Td, Th } from "@/components/ui";
import { Can } from "@/components/edit-only";

type Q = { squad?: string; lob?: string; state?: string; release?: string; from?: string; to?: string; q?: string };

export default async function SprintsPage({ searchParams }: PageProps<"/sprints">) {
  const me = await requirePageAccess("sprints.view");
  const edit = await can("sprints.manage");
  const f = (await searchParams) as Q;
  const a = await loadAnalytics();
  const from = dateParam(f.from);
  const to = dateParam(f.to);
  const q = f.q?.trim().toLowerCase();
  const sprints = a.sprints
    .filter((s) => (!f.squad || s.squadId === f.squad) && (!f.lob || s.lobId === f.lob) && (!f.state || s.state === f.state) && (!f.release || s.releaseId === f.release))
    .filter((s) => (!from || s.end >= from) && (!to || s.start <= to))
    .filter((s) => !q || s.name.toLowerCase().includes(q))
    .sort((x, y) => y.start.getTime() - x.start.getTime());
  const releaseName = new Map(a.releases.map((r) => [r.id, r.name]));
  const lobOptions = a.lobs.map((l) => ({
    id: l.id,
    name: l.name,
    key: l.key,
    squadName: a.squads.find((s) => s.id === l.squadId)?.name ?? "",
    lengthDays: sprintLengthFor(a, l.id),
    nextNumber: a.sprints.filter((s) => s.lobId === l.id).length + 1,
  }));

  return (
    <RoleProvider readOnly={!me.permissions.has("sprints.manage")}>
    <>
      <PageHeader title="Sprints" description="Each line of business runs its own sprints. Sprints may overlap." actions={(await can("sprints.import")) ? <LinkButton href="/sprints/import" variant="primary">Import sprint planning</LinkButton> : undefined} />

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
          <select name="state" defaultValue={f.state ?? ""} className={selectCls} aria-label="State">
            <option value="">Any state</option>
            <option value="PLANNED">Planned</option>
            <option value="ACTIVE">Active</option>
            <option value="PAUSED">Paused</option>
            <option value="CLOSED">Closed</option>
          </select>
          <select name="release" defaultValue={f.release ?? ""} className={selectCls} aria-label="Release">
            <option value="">Any release</option>
            {a.releases.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <label className="flex items-center gap-1 text-xs text-slate-500">
            Between
            <input type="date" name="from" defaultValue={f.from} className={selectCls} aria-label="From" /> –
            <input type="date" name="to" defaultValue={f.to} className={selectCls} aria-label="To" />
          </label>
          <input name="q" defaultValue={f.q} placeholder="Name…" className={`${selectCls} w-36`} aria-label="Search" />
          <button className={applyCls}>Apply</button>
          <Link href="/sprints" className="px-2 py-1.5 text-sm text-slate-500 hover:text-slate-800">Clear</Link>
        </form>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <Card title={`Sprints (${sprints.length})`}>
          {sprints.length === 0 ? (
            <Empty>No sprints match these filters.</Empty>
          ) : (
            <>
            <BulkDeleteBar formId="bulk-sprints" action={deleteSprints} noun="sprint" warning="Their stories and bugs go back to the backlog. Only planned sprints can be deleted; others are kept. This cannot be undone." />
            <Table>
              <thead>
                <tr>
                  {edit && <Th className="w-8" />}
                  <Th>Sprint</Th>
                  <Th>Line of Business</Th>
                  <Th>Dates</Th>
                  <Th>State</Th>
                  <Th>Committed</Th>
                  <Th>Done</Th>
                  <Th>Health</Th>
                  <Th>Release</Th>
                  {edit && <Th />}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sprints.map((s) => (
                  <tr key={s.id}>
                    {edit && (
                      <Td>
                        <input type="checkbox" name="id" value={s.id} form="bulk-sprints" disabled={s.state !== "PLANNED"} aria-label={`Select ${s.name}`} title={s.state === "PLANNED" ? undefined : "Only planned sprints can be deleted"} />
                      </Td>
                    )}
                    <Td><Link href={`/sprints/${s.id}`} className="font-medium text-orange-700 hover:underline">{s.name}</Link></Td>
                    <Td>
                      <span className="font-mono text-xs text-slate-500">{s.lobKey}</span> {s.lobName}
                      <div className="text-xs text-slate-500">{s.squadName}</div>
                    </Td>
                    <Td className="whitespace-nowrap text-xs">{formatDate(s.start)} – {formatDate(s.end)}<div className="text-slate-400">{s.lengthDays} days</div></Td>
                    <Td><SprintStateBadge state={s.state} /></Td>
                    <Td>{fmtH(s.summary.committedHours)}</Td>
                    <Td>{fmtH(s.summary.doneHours)}</Td>
                    <Td>{s.state === "PLANNED" ? <span className="text-slate-400">—</span> : <HealthBadge health={s.summary.health} />}</Td>
                    <Td className="text-xs">{s.releaseId ? <Link href={`/releases/${s.releaseId}`} className="hover:underline">{releaseName.get(s.releaseId)}</Link> : "—"}</Td>
                    {edit && <Td className="text-right text-xs"><Link href={`/sprints/${s.id}#edit`} className="text-orange-700 hover:underline">Edit</Link></Td>}
                  </tr>
                ))}
              </tbody>
            </Table>
            </>
          )}
          {edit && <p className="mt-3 text-xs text-slate-500">Only planned sprints can be ticked for deletion; active, paused and closed sprints keep their history.</p>}
        </Card>

        <Can perm="sprints.manage">
        <Card title="New sprint">
          {lobOptions.length === 0 ? (
            <Empty>Create a line of business first.</Empty>
          ) : (
            <NewSprintForm lobs={lobOptions} defaultLobId={f.lob} today={toISODate(a.today)} />
          )}
        </Card>
        </Can>
      </div>
    </>
    </RoleProvider>
  );
}
