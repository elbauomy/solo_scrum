import Link from "next/link";
import { requirePageAccess } from "@/lib/auth";
import { RoleProvider } from "@/components/role-provider";
import { notFound } from "next/navigation";
import { loadAnalytics } from "@/lib/analytics";
import { deleteRelease, setDeployed, updateRelease } from "@/lib/actions/releases";
import { formatDate, toISODate } from "@/lib/dates";
import { ActionForm, DeleteButton, SubmitButton } from "@/components/ui/forms";
import { ReleaseSelect } from "@/components/item-actions";
import { ReleaseStatus } from "@/components/release-status";
import { HealthBadge, SprintStateBadge, fmtH } from "@/components/sprint-ui";
import { Card, Empty, Field, Input, LinkButton, PageHeader, Stat, Table, Td, Textarea, Th } from "@/components/ui";
import { Can } from "@/components/edit-only";

export default async function ReleasePage({ params }: PageProps<"/releases/[id]">) {
  const me = await requirePageAccess("releases.view");
  const { id } = await params;
  const a = await loadAnalytics();
  const r = a.releases.find((x) => x.id === id);
  if (!r) notFound();
  const sprints = a.sprints.filter((s) => s.releaseId === id);
  const free = a.sprints.filter((s) => s.lobId === r.lobId && !s.releaseId);
  const progress = r.totalHours > 0 ? Math.round((r.doneHours / r.totalHours) * 100) : null;
  const releaseOptions = [{ id: r.id, name: r.name }];

  return (
    <RoleProvider readOnly={!me.permissions.has("releases.manage")}>
    <>
      <PageHeader
        title={`${r.name}${r.version ? ` · v${r.version}` : ""}`}
        description={`${r.lobKey} · ${r.lobName} · ${r.squadName}`}
        actions={<div className="flex items-center gap-2"><ReleaseStatus release={r} today={a.today} /><LinkButton href="/releases">← Releases</LinkButton></div>}
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat label="Target" value={formatDate(r.targetDate)} hint={r.changes.length ? `Moved ${r.changes.length} time(s)` : "Never moved"} />
        <Stat label="Forecast" value={r.deployedDate ? "Deployed" : r.forecast ? formatDate(r.forecast) : "—"} hint={r.deployedDate ? formatDate(r.deployedDate) : r.forecastDelayDays == null ? "Needs closed sprints" : r.forecastDelayDays > 0 ? `${r.forecastDelayDays} day(s) after target` : "On or before target"} />
        <Stat label="Remaining" value={fmtH(r.remainingHours)} hint="Open sprints of this release" />
        <Stat label="Done" value={fmtH(r.doneHours)} />
        <Stat label="Progress" value={progress == null ? "—" : `${progress}%`} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <Card title={`Sprints in this release (${sprints.length})`}>
            {sprints.length === 0 ? (
              <Empty>No sprints yet. Add one below.</Empty>
            ) : (
              <Table>
                <thead><tr><Th>Sprint</Th><Th>Dates</Th><Th>State</Th><Th className="text-right">Done</Th><Th className="text-right">Remaining</Th><Th>Health</Th><Th /></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {sprints.map((s) => (
                    <tr key={s.id}>
                      <Td><Link href={`/sprints/${s.id}`} className="font-medium text-orange-700 hover:underline">{s.name}</Link></Td>
                      <Td className="whitespace-nowrap text-xs">{formatDate(s.start)} – {formatDate(s.end)}</Td>
                      <Td><SprintStateBadge state={s.state} /></Td>
                      <Td className="text-right">{fmtH(s.summary.doneHours)}</Td>
                      <Td className="text-right">{s.state === "CLOSED" ? "—" : fmtH(s.summary.remainingHours)}</Td>
                      <Td>{s.state === "PLANNED" ? "—" : <HealthBadge health={s.summary.health} />}</Td>
                      <Td className="text-right"><ReleaseSelect sprintId={s.id} value={r.id} options={releaseOptions} /></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
            {free.length > 0 && (
              <Can perm="releases.manage">
              <div className="mt-4 border-t border-slate-200 pt-3">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Add a sprint</h3>
                <ul className="space-y-2">
                  {free.map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-2 text-sm">
                      <span>{s.name} <span className="text-xs text-slate-500">({formatDate(s.start)} – {formatDate(s.end)})</span></span>
                      <ReleaseSelect sprintId={s.id} value="" options={releaseOptions} />
                    </li>
                  ))}
                </ul>
              </div>
              </Can>
            )}
          </Card>

          <Card title="Target date history">
            {r.changes.length === 0 ? (
              <Empty>The target date has not changed.</Empty>
            ) : (
              <Table>
                <thead><tr><Th>Changed on</Th><Th>From</Th><Th>To</Th><Th>Moved by</Th><Th>Reason</Th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {r.changes.map((c) => {
                    const days = Math.round((c.newDate.getTime() - c.oldDate.getTime()) / 86400000);
                    return (
                      <tr key={c.id}>
                        <Td className="whitespace-nowrap text-xs">{c.changedAt.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</Td>
                        <Td>{formatDate(c.oldDate)}</Td>
                        <Td>{formatDate(c.newDate)}</Td>
                        <Td className={days > 0 ? "text-red-700" : "text-green-700"}>{days > 0 ? `+${days}` : days} day(s)</Td>
                        <Td>{c.reason || "—"}</Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Details">
            <ActionForm action={updateRelease} className="space-y-3" successMessage="Saved." resetOnSuccess={false}>
              <input type="hidden" name="id" value={r.id} />
              <div className="grid grid-cols-[1fr_6rem] gap-3">
                <Field label="Name"><Input name="name" required maxLength={100} defaultValue={r.name} /></Field>
                <Field label="Version"><Input name="version" maxLength={50} defaultValue={r.version} /></Field>
              </div>
              <Field label="Target deployment date"><Input type="date" name="targetDate" required defaultValue={toISODate(r.targetDate)} /></Field>
              <Field label="Reason (if you change the date)"><Input name="reason" maxLength={500} placeholder="e.g. Waiting for UAT sign-off" /></Field>
              <Field label="Notes"><Textarea name="notes" maxLength={1000} defaultValue={r.notes} /></Field>
              <SubmitButton>Save changes</SubmitButton>
            </ActionForm>
          </Card>

          <Card title="Deployment">
            <ActionForm action={setDeployed} className="space-y-3" successMessage="Saved." resetOnSuccess={false}>
              <input type="hidden" name="id" value={r.id} />
              <Field label="Actual deployment date" hint="Leave empty if it has not been deployed yet.">
                <Input type="date" name="deployedDate" defaultValue={r.deployedDate ? toISODate(r.deployedDate) : ""} />
              </Field>
              <SubmitButton variant="secondary">Save deployment date</SubmitButton>
            </ActionForm>
          </Card>

          <Can perm="releases.manage">
          <Card title="Delete">
            <p className="mb-3 text-sm text-slate-500">Its sprints are kept and become unassigned.</p>
            <DeleteButton action={deleteRelease} id={r.id} label="Delete release" confirmText={`Delete release "${r.name}"?`} />
          </Card>
          </Can>
        </div>
      </div>
    </>
    </RoleProvider>
  );
}
