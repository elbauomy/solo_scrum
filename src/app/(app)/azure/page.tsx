import { db } from "@/lib/db";
import { AdoClient, AdoError, adoConfigFromEnv } from "@/lib/ado-client";
import type { SyncSummary } from "@/lib/ado-sync";
import { linkLobProject } from "@/lib/actions/azure";
import { ActionForm, SubmitButton } from "@/components/ui/forms";
import { AzureSyncButtons } from "@/components/azure-sync";
import { Badge, Card, Empty, PageHeader, Select } from "@/components/ui";
import { canEdit } from "@/components/edit-only";

// Reading a project and sending changes can take a while.
export const maxDuration = 60;

export default async function AzurePage() {
  const edit = await canEdit();
  const cfg = adoConfigFromEnv(process.env);
  const lobs = await db.lineOfBusiness.findMany({
    orderBy: { name: "asc" },
    include: { squad: { select: { name: true } }, _count: { select: { workItems: { where: { adoId: { not: null } } } } } },
  });

  let projects: string[] = [];
  let projectError: string | null = null;
  if (cfg && edit) {
    try {
      projects = await new AdoClient(cfg).listProjects();
    } catch (err) {
      projectError = err instanceof AdoError ? err.message : "Could not load the Azure DevOps projects.";
    }
  }

  return (
    <>
      <PageHeader
        title="Azure DevOps"
        description="Keep each line of business in step with its Azure DevOps project. Changes come in and go back out when you press Sync now."
      />

      {!cfg && (
        <Card title="Not connected yet" className="mb-6">
          <p className="text-sm text-slate-600">
            The owner needs to add two settings in the hosting dashboard (Vercel → Settings → Environment Variables): <code>ADO_ORG</code> (your organization name) and <code>ADO_PAT</code> (an access token with
            Work Items &ldquo;Read &amp; write&rdquo;). Then redeploy. The steps are in the user guide.
          </p>
        </Card>
      )}
      {projectError && <p role="alert" className="mb-6 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{projectError}</p>}

      <Card title="How the sync works" className="mb-6">
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
          <li><strong>Azure DevOps decides</strong> the title, description, acceptance criteria, type and where an item sits in the hierarchy.</li>
          <li><strong>This system decides</strong> hours, order, blocked flags and priority (after the item is first brought in). Task hours are sent to Azure DevOps as &ldquo;Remaining work&rdquo;.</li>
          <li><strong>Both sides</strong> can change status, the assignee of a task and the sprint of a story or bug. If both changed since the last sync, the most recent change wins and is listed in the report.</li>
          <li>Nothing is ever deleted, and new items are only created here, never in Azure DevOps. Assignees are matched to members by name.</li>
          <li>Always press <strong>Check changes</strong> first: it shows what would happen and changes nothing. The first sync of a project skips finished items older than 60 days unless you tick the box.</li>
        </ul>
      </Card>

      {lobs.length === 0 ? (
        <Card><Empty>Create a line of business first, then link it to its Azure DevOps project here.</Empty></Card>
      ) : (
        <div className="space-y-6">
          {lobs.map((l) => {
            const last = l.adoLastResult as SyncSummary | null;
            return (
              <Card
                key={l.id}
                title={`${l.name} (${l.key})`}
                actions={l.adoProject ? <Badge tone="green">Linked to {l.adoProject}</Badge> : <Badge>Not linked</Badge>}
              >
                <div className="space-y-4">
                  {edit && cfg ? (
                    <ActionForm action={linkLobProject} successMessage="Saved." resetOnSuccess={false} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="lobId" value={l.id} />
                      <Select name="project" defaultValue={l.adoProject ?? ""} className="max-w-xs" disabled={l._count.workItems > 0}>
                        <option value="">Not linked</option>
                        {l.adoProject && !projects.includes(l.adoProject) && <option value={l.adoProject}>{l.adoProject}</option>}
                        {projects.map((p) => <option key={p} value={p}>{p}</option>)}
                      </Select>
                      {l._count.workItems === 0 ? <SubmitButton variant="secondary">Save link</SubmitButton> : <span className="text-xs text-slate-500">{l._count.workItems} item(s) linked, so the project is fixed.</span>}
                    </ActionForm>
                  ) : (
                    <p className="text-sm text-slate-600">{l.adoProject ? `Azure DevOps project: ${l.adoProject}` : "Not linked to an Azure DevOps project."}</p>
                  )}
                  {cfg && <AzureSyncButtons lobId={l.id} linked={Boolean(l.adoProject)} />}
                  {last && l.adoLastSyncAt && (
                    <div className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
                      <p className="font-medium">Last sync: {l.adoLastSyncAt.toISOString().replace("T", " ").slice(0, 16)} UTC</p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-5">{last.lines.map((line, i) => <li key={i}>{line}</li>)}</ul>
                      {last.errors.length > 0 && <p className="mt-1 text-amber-700">{last.errors.length} thing(s) needed attention: {last.errors[0]}</p>}
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
