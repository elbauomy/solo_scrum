import { ActionForm, SubmitButton } from "@/components/ui/forms";
import { Field, Input } from "@/components/ui";
import { PermissionChecklist } from "@/components/permission-checklist";
import { PERMISSION_GROUPS } from "@/lib/permissions";
import type { ActionState } from "@/lib/action-state";

type Role = { id: string; name: string; description: string; builtIn: boolean; permissions: string[] };

export function RoleForm({ action, role, submitLabel }: { action: (s: ActionState, f: FormData) => Promise<ActionState>; role?: Role; submitLabel: string }) {
  return (
    <ActionForm action={action} className="space-y-5" resetOnSuccess={false}>
      {role && <input type="hidden" name="id" value={role.id} />}
      <div className="grid gap-4 md:grid-cols-[18rem_1fr]">
        <Field label="Name">
          <Input name="name" required maxLength={60} defaultValue={role?.name} disabled={role?.builtIn} />
        </Field>
        <Field label="Description" hint="What this role is for, for example &quot;Developers: move cards and write standups&quot;">
          <Input name="description" maxLength={300} defaultValue={role?.description} disabled={role?.builtIn} />
        </Field>
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Permissions</h3>
        <PermissionChecklist groups={PERMISSION_GROUPS} initial={role?.permissions ?? []} locked={role?.builtIn} />
      </div>
      {!role?.builtIn && <SubmitButton>{submitLabel}</SubmitButton>}
    </ActionForm>
  );
}
