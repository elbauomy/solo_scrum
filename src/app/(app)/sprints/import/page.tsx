import { db } from "@/lib/db";
import { requirePageAccess, can } from "@/lib/auth";
import { RoleProvider } from "@/components/role-provider";
import { SprintImportForm } from "@/components/sprint-import-form";
import { Card, LinkButton, PageHeader } from "@/components/ui";

// Reading a large sheet and saving every story and task can take a few seconds.
export const maxDuration = 60;

export default async function SprintImportPage() {
  const me = await requirePageAccess("sprints.import");
  const edit = await can("sprints.import");
  const lobs = await db.lineOfBusiness.findMany({ orderBy: { name: "asc" }, include: { squad: { select: { name: true } } } });
  return (
    <RoleProvider readOnly={!me.permissions.has("sprints.import")}>
    <>
      <PageHeader
        title="Import sprint planning"
        description="Bring the sprint, each member's capacity, the user stories and their tasks from your planning sheet."
        actions={<LinkButton href="/sprints">← Sprints</LinkButton>}
      />
      {edit ? (
      <SprintImportForm lobs={lobs.map((l) => ({ id: l.id, label: `${l.key} · ${l.name} (${l.squad.name})` }))} />
      ) : (
        <Card><p className="py-4 text-center text-sm text-slate-600">Your role does not allow importing sprint planning sheets.</p></Card>
      )}
      <Card title="How the sheet is read" className="mt-6">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-slate-600">
          <li><strong>Title row</strong>: &ldquo;Line of business - Release - Sprint&rdquo;, then <em>From</em> and <em>To</em> dates and the number of days.</li>
          <li><strong>Team Member row</strong>: one column per member (&ldquo;Dev (1)&rdquo; on the first line is the role, the second line is the name). Members that are not in the system are created and added to the squad of the line of business.</li>
          <li><strong>Capacity rows</strong>: availability %, initial buffer hours, meetings, vacations (days), excuses (hours), done-definition and special tasks. They give each member&apos;s capacity for the sprint (the sheet&apos;s Final Buffer).</li>
          <li><strong>Stories</strong>: a numbered row with the story title, then one row per task type (UI Task, Back End Task, Test Execution…). A number of hours in a member&apos;s column creates one task for that member. Stories with no hours are left out.</li>
          <li><strong>Columns to the right of the members</strong> (for example <em>Branch</em>) are added to the new story&apos;s description.</li>
          <li><strong>Uploading again</strong> updates the same sprint: stories and tasks are matched by name, changed hours are updated, nothing is deleted, and Done work is never touched.</li>
          <li>Afterwards the <strong>Timeline</strong> plans every task&apos;s dates automatically from its hours and the member&apos;s availability, and the board, standup and reports follow the sprint daily.</li>
        </ul>
      </Card>
    </>
    </RoleProvider>
  );
}
