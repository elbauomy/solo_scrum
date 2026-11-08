import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { deleteRole, updateRole } from "@/lib/actions/roles";
import { ALL_PERMISSIONS } from "@/lib/permissions";
import { Card, Empty, LinkButton, PageHeader } from "@/components/ui";
import { DeleteButton } from "@/components/ui/forms";
import { RoleForm } from "@/components/role-form";

export default async function RolePage({ params, searchParams }: PageProps<"/roles/[id]">) {
  await requirePageAccess("roles.manage");
  const { id } = await params;
  const { saved } = (await searchParams) as { saved?: string };
  const role = await db.role.findUnique({
    where: { id },
    include: { permissions: true, users: { select: { id: true, displayName: true, active: true }, orderBy: { displayName: "asc" } } },
  });
  if (!role) notFound();
  const permissions = role.builtIn ? ALL_PERMISSIONS : role.permissions.map((p) => p.permission);
  return (
    <>
      <PageHeader
        title={role.name}
        description={role.builtIn ? "Has every permission, including managing users and roles. It cannot be changed or deleted." : role.description || "Edit the name and the permissions."}
        actions={<LinkButton href="/roles">← Roles</LinkButton>}
      />
      {saved && <p role="status" className="mb-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">Role created.</p>}
      <div className="grid gap-6 xl:grid-cols-[1fr_20rem]">
        <Card title="Role">
          <RoleForm action={updateRole} role={{ id: role.id, name: role.name, description: role.description, builtIn: role.builtIn, permissions }} submitLabel="Save role" />
        </Card>
        <div className="space-y-6">
          <Card title={`Users with this role (${role.users.length})`}>
            {role.users.length === 0 ? (
              <Empty>Nobody has this role yet.</Empty>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {role.users.map((u) => (
                  <li key={u.id}>
                    <Link href={`/users/${u.id}`} className="text-orange-700 hover:underline">{u.displayName}</Link>
                    {!u.active && <span className="ml-2 text-xs text-slate-500">(disabled)</span>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {!role.builtIn && (
            <Card title="Delete">
              <p className="mb-3 text-sm text-slate-500">Only a role nobody has can be deleted.</p>
              <DeleteButton action={deleteRole} id={role.id} label="Delete role" confirmText={`Delete the role "${role.name}"?`} />
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
