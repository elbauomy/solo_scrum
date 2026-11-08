import Link from "next/link";
import { requirePageAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { ALL_PERMISSIONS } from "@/lib/permissions";
import { Badge, Card, LinkButton, PageHeader, Table, Td, Th } from "@/components/ui";

export default async function RolesPage() {
  await requirePageAccess("roles.manage");
  const roles = await db.role.findMany({
    orderBy: [{ builtIn: "desc" }, { name: "asc" }],
    include: { _count: { select: { users: true, permissions: true } } },
  });
  return (
    <>
      <PageHeader
        title="Roles & Permissions"
        description="A role is a name and a list of permissions. Every user has exactly one role."
        actions={<LinkButton href="/roles/new" variant="primary">New role</LinkButton>}
      />
      <Card title={`Roles (${roles.length})`}>
        <Table>
          <thead>
            <tr>
              <Th>Role</Th>
              <Th>Description</Th>
              <Th>Permissions</Th>
              <Th>Users</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {roles.map((r) => (
              <tr key={r.id}>
                <Td>
                  <Link href={`/roles/${r.id}`} className="font-medium text-orange-700 hover:underline">{r.name}</Link>
                  {r.builtIn && <span className="ml-2"><Badge tone="orange">Built in</Badge></span>}
                </Td>
                <Td className="max-w-md text-slate-500">{r.description}</Td>
                <Td>{r.builtIn ? "All" : `${r._count.permissions} of ${ALL_PERMISSIONS.length}`}</Td>
                <Td>{r._count.users}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
