import Link from "next/link";
import { requirePageAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { createUser } from "@/lib/actions/users";
import { generateTemporaryPassword } from "@/lib/passwords";
import { ActionForm, SubmitButton } from "@/components/ui/forms";
import { Badge, Card, Empty, Field, Input, PageHeader, Table, Td, Th } from "@/components/ui";
import { UserFields } from "@/components/user-fields";
import { formatDate } from "@/lib/dates";

export default async function UsersPage({ searchParams }: PageProps<"/users">) {
  await requirePageAccess("users.manage");
  const { member: memberParam, q } = (await searchParams) as { member?: string; q?: string };
  const [users, roles, freeMembers] = await Promise.all([
    db.user.findMany({
      where: q ? { OR: [{ displayName: { contains: q, mode: "insensitive" } }, { username: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] } : undefined,
      orderBy: { displayName: "asc" },
      include: { role: { select: { name: true, builtIn: true } }, member: { select: { name: true } } },
    }),
    db.role.findMany({ orderBy: [{ builtIn: "desc" }, { name: "asc" }], select: { id: true, name: true } }),
    db.member.findMany({ where: { user: null, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const preset = freeMembers.find((m) => m.id === memberParam);

  return (
    <>
      <PageHeader title="Users" description="Who can sign in, and with which role. Give any member an account, or add someone who is not a member." />
      <div className="grid gap-6 xl:grid-cols-[1fr_24rem]">
        <Card
          title={`Users (${users.length})`}
          actions={
            <form className="flex gap-2">
              <input name="q" defaultValue={q} placeholder="Search…" className="w-40 rounded-md border border-slate-300 px-2 py-1 text-sm" />
              <button className="rounded-md border border-slate-300 px-2 py-1 text-sm">Search</button>
            </form>
          }
        >
          {users.length === 0 ? (
            <Empty>No users match your search.</Empty>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th>User name</Th>
                  <Th>Role</Th>
                  <Th>Member</Th>
                  <Th>Last sign-in</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.map((u) => (
                  <tr key={u.id}>
                    <Td>
                      <Link href={`/users/${u.id}`} className="font-medium text-orange-700 hover:underline">{u.displayName}</Link>
                      {u.email && <div className="text-xs text-slate-500">{u.email}</div>}
                    </Td>
                    <Td className="font-mono text-xs">{u.username}</Td>
                    <Td>{u.role.builtIn ? <Badge tone="orange">{u.role.name}</Badge> : u.role.name}</Td>
                    <Td>{u.member?.name ?? <span className="text-slate-400">—</span>}</Td>
                    <Td className="text-xs">{u.lastLoginAt ? formatDate(u.lastLoginAt) : "Never"}</Td>
                    <Td>
                      {!u.active ? <Badge tone="red">Disabled</Badge> : u.mustChangePassword ? <Badge tone="amber">Temporary password</Badge> : <Badge tone="green">Active</Badge>}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card title="Add a user">
          <ActionForm action={createUser} className="space-y-3">
            <UserFields
              roles={roles.map((r) => ({ id: r.id, label: r.name }))}
              members={freeMembers.map((m) => ({ id: m.id, label: m.name }))}
              user={preset ? { displayName: preset.name, username: preset.name.toLowerCase(), email: null, roleId: "", memberId: preset.id } : undefined}
            />
            <Field label="Temporary password" hint="Give it to the person. They must choose their own at the first sign-in">
              <Input name="password" required minLength={10} defaultValue={generateTemporaryPassword()} className="font-mono" autoComplete="off" />
            </Field>
            <SubmitButton>Add user</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
