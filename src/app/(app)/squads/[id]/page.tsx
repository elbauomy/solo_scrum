import Link from "next/link";
import { requirePageAccess } from "@/lib/auth";
import { RoleProvider } from "@/components/role-provider";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { deleteSquad, updateSquad } from "@/lib/actions/squads";
import { ActionForm, DeleteButton, SubmitButton } from "@/components/ui/forms";
import { Badge, Card, Empty, LinkButton, PageHeader, Table, Td, Th } from "@/components/ui";
import { SquadFields } from "@/components/entity-fields";

export default async function SquadPage({ params }: PageProps<"/squads/[id]">) {
  const me = await requirePageAccess("squads.view");
  const { id } = await params;
  const [squad, settings] = await Promise.all([
    db.squad.findUnique({
      where: { id },
      include: {
        lobs: { orderBy: { name: "asc" } },
        memberships: { include: { member: true }, orderBy: { member: { name: "asc" } } },
      },
    }),
    getSettings(),
  ]);
  if (!squad) notFound();

  return (
    <RoleProvider readOnly={!me.permissions.has("squads.manage")}>
    <>
      <PageHeader
        title={squad.name}
        description="Squad details"
        actions={<LinkButton href="/squads">← Back to squads</LinkButton>}
      />
      <div className="grid gap-6 xl:grid-cols-[22rem_1fr]">
        <Card title="Edit squad">
          <ActionForm action={updateSquad} className="space-y-3" resetOnSuccess={false}>
            <input type="hidden" name="id" value={squad.id} />
            <SquadFields defaultSprint={settings.defaultSprintLengthDays} values={squad} />
            <div className="flex items-center justify-between">
              <SubmitButton>Save changes</SubmitButton>
            </div>
          </ActionForm>
          <div className="mt-6 border-t border-slate-200 pt-4">
            <DeleteButton
              action={deleteSquad}
              id={squad.id}
              label="Delete squad"
              confirmText={`Delete squad "${squad.name}"? This cannot be undone.`}
            />
          </div>
        </Card>

        <div className="space-y-6">
          <Card title={`Lines of Business (${squad.lobs.length})`} actions={<LinkButton href="/lobs" className="px-2 py-1 text-xs">Manage</LinkButton>}>
            {squad.lobs.length === 0 ? (
              <Empty>This squad owns no lines of business yet.</Empty>
            ) : (
              <ul className="divide-y divide-slate-100">
                {squad.lobs.map((l) => (
                  <li key={l.id} className="flex justify-between py-2 text-sm">
                    <Link href={`/lobs/${l.id}`} className="font-medium text-orange-700 hover:underline">{l.name}</Link>
                    <span className="text-slate-500">
                      Sprint: {l.sprintLengthDays ?? squad.sprintLengthDays ?? settings.defaultSprintLengthDays} days
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title={`Members (${squad.memberships.length})`} actions={<LinkButton href="/members" className="px-2 py-1 text-xs">Manage</LinkButton>}>
            {squad.memberships.length === 0 ? (
              <Empty>No members in this squad yet.</Empty>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Name</Th>
                    <Th>Role</Th>
                    <Th>Hours / week</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {squad.memberships.map((m) => (
                    <tr key={m.id}>
                      <Td>
                        <Link href={`/members/${m.member.id}`} className="font-medium text-orange-700 hover:underline">{m.member.name}</Link>
                      </Td>
                      <Td>{m.member.role || "—"}</Td>
                      <Td>{m.weeklyHours} h</Td>
                      <Td>{m.member.active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>
      </div>
    </>
    </RoleProvider>
  );
}
