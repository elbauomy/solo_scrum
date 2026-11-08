import { requireSession } from "@/lib/auth";
import { changePassword } from "@/lib/actions/profile";
import { ActionForm, SubmitButton } from "@/components/ui/forms";
import { Card, Field, PageHeader } from "@/components/ui";
import { PasswordInput } from "@/components/ui/password-input";
import { MIN_PASSWORD_LENGTH } from "@/lib/passwords";

export default async function ProfilePage() {
  const me = await requireSession();
  return (
    <>
      <PageHeader title="Your profile" description="Your account details and your password." />
      {me.mustChangePassword && (
        <p role="note" className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          You signed in with a temporary password. Choose your own password to continue.
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Account">
          <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
            <dt className="text-slate-500">Name</dt><dd className="font-medium text-slate-900">{me.displayName}</dd>
            <dt className="text-slate-500">User name</dt><dd className="font-mono text-xs leading-6">{me.username}</dd>
            <dt className="text-slate-500">Email</dt><dd>{me.email ?? <span className="text-slate-400">Not set</span>}</dd>
            <dt className="text-slate-500">Role</dt><dd>{me.roleName}</dd>
          </dl>
          <p className="mt-4 text-xs text-slate-500">Only an administrator can change your name, email or role.</p>
        </Card>
        <Card title={me.hasPassword ? "Change password" : "Set a password"}>
          <ActionForm action={changePassword} className="space-y-3" successMessage="Password changed.">
            {me.hasPassword && (
              <Field label={me.mustChangePassword ? "Temporary password" : "Current password"}>
                <PasswordInput name="current" required autoComplete="current-password" />
              </Field>
            )}
            <Field label="New password" hint={`At least ${MIN_PASSWORD_LENGTH} characters, not your user name`}>
              <PasswordInput name="next" required minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password" />
            </Field>
            <Field label="New password again">
              <PasswordInput name="confirm" required minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password" />
            </Field>
            <SubmitButton>{me.hasPassword ? "Change password" : "Set password"}</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
