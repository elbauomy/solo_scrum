import { notFound } from "next/navigation";
import { requirePageAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { deleteUser, resetUserPassword, updateUser } from "@/lib/actions/users";
import { generateTemporaryPassword } from "@/lib/passwords";
import { ActionForm, DeleteButton, SubmitButton } from "@/components/ui/forms";
import { Badge, Card, Field, Input, LinkButton, PageHeader } from "@/components/ui";
import { UserFields } from "@/components/user-fields";
import { formatDate } from "@/lib/dates";

export default async function UserPage({ params, searchParams }: PageProps<"/users/[id]">) {
  const me = await requirePageAccess("users.manage");
  const { id } = await params;
  const { created } = (await searchParams) as { created?: string };
  const [user, roles] = await Promise.all([
    db.user.findUnique({ where: { id }, include: { role: true, member: { select: { id: true, name: true } } } }),
    db.role.findMany({ orderBy: [{ builtIn: "desc" }, { name: "asc" }], select: { id: true, name: true } }),
  ]);
  if (!user) notFound();
  const members = await db.member.findMany({
    where: { OR: [{ user: null }, { id: user.memberId ?? "" }] },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  const self = user.id === me.id;

  return (
    <>
      <PageHeader
        title={user.displayName}
        description={`${user.role.name} · last sign-in ${user.lastLoginAt ? formatDate(user.lastLoginAt) : "never"}`}
        actions={<LinkButton href="/users">← Users</LinkButton>}
      />
      {created && (
        <p role="status" className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
          User added. Give them their user name <strong>{user.username}</strong> and the temporary password you typed; they choose their own at the first sign-in.
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <Card title="Account" actions={!user.active ? <Badge tone="red">Disabled</Badge> : user.mustChangePassword ? <Badge tone="amber">Temporary password</Badge> : <Badge tone="green">Active</Badge>}>
          <ActionForm action={updateUser} className="space-y-3" successMessage="Saved." resetOnSuccess={false}>
            <input type="hidden" name="id" value={user.id} />
            <UserFields
              roles={roles.map((r) => ({ id: r.id, label: r.name }))}
              members={members.map((m) => ({ id: m.id, label: m.name }))}
              user={user}
            />
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" name="active" defaultChecked={user.active} disabled={self} />
              Can sign in {self && <span className="text-xs text-slate-500">(you cannot disable yourself)</span>}
            </label>
            {self && <input type="hidden" name="active" value="on" />}
            <SubmitButton>Save</SubmitButton>
          </ActionForm>
        </Card>

        <div className="space-y-6">
          <Card title="Reset password">
            <p className="mb-3 text-sm text-slate-500">Sets a temporary password and signs them out everywhere. They choose their own at the next sign-in.</p>
            <ActionForm action={resetUserPassword} className="space-y-3">
              <input type="hidden" name="id" value={user.id} />
              <Field label="Temporary password">
                <Input name="password" required minLength={10} defaultValue={generateTemporaryPassword()} className="font-mono" autoComplete="off" />
              </Field>
              <SubmitButton variant="secondary">Reset password</SubmitButton>
            </ActionForm>
          </Card>
          {!self && (
            <Card title="Delete">
              <p className="mb-3 text-sm text-slate-500">Removes the account only. The member, their tasks and history stay. To keep the account but stop sign-in, untick &quot;Can sign in&quot; instead.</p>
              <DeleteButton action={deleteUser} id={user.id} label="Delete user" confirmText={`Delete the account of ${user.displayName}?`} />
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
