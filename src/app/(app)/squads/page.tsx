import Link from "next/link";
import { requirePageAccess } from "@/lib/auth";
import { RoleProvider } from "@/components/role-provider";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { createSquad } from "@/lib/actions/squads";
import { ActionForm, SubmitButton } from "@/components/ui/forms";
import { Card, Empty, PageHeader, Table, Td, Th } from "@/components/ui";
import { SquadFields } from "@/components/entity-fields";
import { Can } from "@/components/edit-only";

export default async function SquadsPage({ searchParams }: PageProps<"/squads">) {
  const me = await requirePageAccess("squads.view");
  const { q } = (await searchParams) as { q?: string };
  const [squads, settings] = await Promise.all([
    db.squad.findMany({
      where: q ? { name: { contains: q, mode: "insensitive" } } : undefined,
      orderBy: { name: "asc" },
      include: { lobs: { select: { name: true } }, memberships: { include: { member: { select: { active: true } } } } },
    }),
    getSettings(),
  ]);

  return (
    <RoleProvider readOnly={!me.permissions.has("squads.manage")}>
    <>
      <PageHeader title="Squads" description="Create, edit and remove squads at any time." />

      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <Card
          title={`All squads (${squads.length})`}
          actions={
            <form className="flex gap-2">
              <input name="q" defaultValue={q} placeholder="Search…" className="w-40 rounded-md border border-slate-300 px-2 py-1 text-sm" />
              <button className="rounded-md border border-slate-300 px-2 py-1 text-sm">Search</button>
            </form>
          }
        >
          {squads.length === 0 ? (
            <Empty>{q ? "No squads match your search." : "No squads yet — add one using the form."}</Empty>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Lines of Business</Th>
                  <Th>Members</Th>
                  <Th>Weekly hours</Th>
                  <Th>Sprint length</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {squads.map((s) => {
                  const active = s.memberships.filter((m) => m.member.active);
                  return (
                    <tr key={s.id}>
                      <Td>
                        <Link href={`/squads/${s.id}`} className="font-medium text-orange-700 hover:underline">
                          {s.name}
                        </Link>
                        {s.description && <div className="text-xs text-slate-500">{s.description}</div>}
                      </Td>
                      <Td>{s.lobs.map((l) => l.name).join(", ") || "—"}</Td>
                      <Td>{active.length}</Td>
                      <Td>{active.reduce((sum, m) => sum + m.weeklyHours, 0).toFixed(1)} h</Td>
                      <Td>
                        {s.sprintLengthDays ?? settings.defaultSprintLengthDays} days
                        {s.sprintLengthDays == null && <span className="text-xs text-slate-400"> (default)</span>}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>

        <Can perm="squads.manage">
        <Card title="Add squad">
          <ActionForm action={createSquad} className="space-y-3" successMessage="Squad added.">
            <SquadFields defaultSprint={settings.defaultSprintLengthDays} />
            <SubmitButton>Add squad</SubmitButton>
          </ActionForm>
        </Card>
        </Can>
      </div>
    </>
    </RoleProvider>
  );
}
