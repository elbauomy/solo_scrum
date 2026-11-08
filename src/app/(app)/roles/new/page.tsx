import { requirePageAccess } from "@/lib/auth";
import { createRole } from "@/lib/actions/roles";
import { Card, LinkButton, PageHeader } from "@/components/ui";
import { RoleForm } from "@/components/role-form";

export default async function NewRolePage() {
  await requirePageAccess("roles.manage");
  return (
    <>
      <PageHeader title="New role" description="Name the role and tick what it may do. Giving any permission on a page also gives &quot;View&quot; on it." actions={<LinkButton href="/roles">← Roles</LinkButton>} />
      <Card>
        <RoleForm action={createRole} submitLabel="Create role" />
      </Card>
    </>
  );
}
