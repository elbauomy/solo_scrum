import Link from "next/link";
import { requirePageAccess, can } from "@/lib/auth";
import { RoleProvider } from "@/components/role-provider";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { todayUTC } from "@/lib/dates";
import { createMember, deleteMember, deleteMembers } from "@/lib/actions/members";
import { BulkDeleteBar } from "@/components/bulk-delete";
import { DeleteButton } from "@/components/ui/forms";
import { ActionForm, SubmitButton } from "@/components/ui/forms";
import { Badge, Card, Empty, Field, Input, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { Can } from "@/components/edit-only";

export default async function MembersPage({ searchParams }: PageProps<"/members">) {
  const me = await requirePageAccess("members.view");
  const edit = await can("members.manage");
  const { squad, status = "active", q } = (await searchParams) as { squad?: string; status?: string; q?: string };
  const [members, squads, settings] = await Promise.all([
    db.member.findMany({
      where: {
        ...(squad ? { memberships: { some: { squadId: squad } } } : {}),
        ...(status === "active" ? { active: true } : status === "inactive" ? { active: false } : {}),
        ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" as const } }, { role: { contains: q, mode: "insensitive" as const } }] } : {}),
      },
      orderBy: { name: "asc" },
      include: { memberships: { include: { squad: true, lobAllocations: { include: { lob: { select: { key: true } } } } } }, leaves: true },
    }),
    db.squad.findMany({ orderBy: { name: "asc" } }),
    getSettings(),
  ]);
  const today = todayUTC();
  const suggestedWeekly = settings.defaultDailyHours * settings.workingDays.length;

  return (
    <RoleProvider readOnly={!me.permissions.has("members.manage")}>
    <>
      <PageHeader title="Members" description="Squad members are names only — they do not log in. A member can work in several squads." />

      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <Card
          title={`Members (${members.length})`}
          actions={
            <form className="flex flex-wrap gap-2">
              <select name="squad" defaultValue={squad ?? ""} className="rounded-md border border-slate-300 px-2 py-1 text-sm">
                <option value="">All squads</option>
                {squads.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <select name="status" defaultValue={status} className="rounded-md border border-slate-300 px-2 py-1 text-sm">
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="all">All</option>
              </select>
              <input name="q" defaultValue={q} placeholder="Name or role…" className="w-36 rounded-md border border-slate-300 px-2 py-1 text-sm" />
              <button className="rounded-md border border-slate-300 px-2 py-1 text-sm">Filter</button>
            </form>
          }
        >
          {members.length === 0 ? (
            <Empty>No members match these filters.</Empty>
          ) : (
            <>
            <BulkDeleteBar formId="bulk-members" action={deleteMembers} noun="member" warning="Their tasks become unassigned, and their squad hours, leave and standup notes are removed. This cannot be undone." />
            <Table>
              <thead>
                <tr>
                  {edit && <Th className="w-8" />}
                  <Th>Name</Th>
                  <Th>Role</Th>
                  <Th>Squads (hours / week)</Th>
                  <Th>Total / week</Th>
                  <Th>Status</Th>
                  {edit && <Th />}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {members.map((m) => {
                  const onLeave = m.leaves.some((l) => l.startDate <= today && l.endDate >= today);
                  return (
                    <tr key={m.id}>
                      {edit && <Td><input type="checkbox" name="id" value={m.id} form="bulk-members" aria-label={`Select ${m.name}`} /></Td>}
                      <Td>
                        <Link href={`/members/${m.id}`} className="font-medium text-orange-700 hover:underline">{m.name}</Link>
                      </Td>
                      <Td>{m.role || "—"}</Td>
                      <Td>
                        {m.memberships.length === 0
                          ? <span className="text-slate-400">No squad</span>
                          : m.memberships.map((ms) => {
                              const split = ms.lobAllocations.map((a) => `${a.lob.key} ${a.weeklyHours}h`).join(", ");
                              return `${ms.squad.name} (${ms.weeklyHours}h${split ? `: ${split}` : ""})`;
                            }).join(", ")}
                      </Td>
                      <Td>{m.memberships.reduce((s, ms) => s + ms.weeklyHours, 0)} h</Td>
                      <Td className="space-x-1">
                        {m.active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}
                        {onLeave && <Badge tone="amber">On leave</Badge>}
                      </Td>
                      {edit && <Td className="text-right">
                        <DeleteButton action={deleteMember} id={m.id} label="Delete" confirmText={`Delete ${m.name}? Their tasks become unassigned, and their squad hours, leave and standup notes are removed. This cannot be undone.`} />
                      </Td>}
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            </>
          )}
        </Card>

        <Can perm="members.manage">
        <Card title="Add member">
          <ActionForm action={createMember} className="space-y-3" successMessage="Member added.">
            <Field label="Name">
              <Input name="name" required maxLength={100} />
            </Field>
            <Field label="Role" hint="e.g. Backend Developer, QA, BA">
              <Input name="role" maxLength={100} />
            </Field>
            <Field label="Squad (optional)">
              <Select name="squadId" defaultValue={squad ?? ""}>
                <option value="">No squad yet</option>
                {squads.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Hours per week in this squad" hint="Add more squads, and split hours across lines of business, from the member's page.">
              <Input type="number" name="weeklyHours" step="0.5" min="0" max="168" defaultValue={suggestedWeekly} />
            </Field>
            <SubmitButton>Add member</SubmitButton>
          </ActionForm>
        </Card>
        </Can>
      </div>
    </>
    </RoleProvider>
  );
}
