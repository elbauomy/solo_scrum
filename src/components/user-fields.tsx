import { Field, Input, Select } from "@/components/ui";

type Option = { id: string; label: string };

/** Name, user name, email, role and linked member: shared by "Add user" and "Edit user". */
export function UserFields({
  roles,
  members,
  user,
}: {
  roles: Option[];
  members: Option[];
  user?: { displayName: string; username: string; email: string | null; roleId: string; memberId: string | null };
}) {
  return (
    <>
      <Field label="Name" hint="As shown in the app">
        <Input name="displayName" required maxLength={100} defaultValue={user?.displayName} />
      </Field>
      <Field label="User name" hint="What they type to sign in. Letters, digits and spaces; capitals do not matter">
        <Input name="username" required minLength={3} maxLength={60} defaultValue={user?.username} autoCapitalize="none" spellCheck={false} />
      </Field>
      <Field label="Work email (optional)" hint="Needed for &quot;Sign in with Microsoft&quot;. Must match their Microsoft account">
        <Input name="email" type="email" maxLength={200} defaultValue={user?.email ?? ""} autoCapitalize="none" spellCheck={false} />
      </Field>
      <Field label="Role">
        <Select name="roleId" required defaultValue={user?.roleId ?? ""}>
          <option value="" disabled>Choose a role…</option>
          {roles.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </Select>
      </Field>
      <Field label="Member (optional)" hint="Links the account to a squad member">
        <Select name="memberId" defaultValue={user?.memberId ?? ""}>
          <option value="">Not a member</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </Select>
      </Field>
    </>
  );
}
