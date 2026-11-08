"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { type ActionState, toActionError } from "@/lib/action-state";
import { displayName as titleCase, normalizeName } from "@/lib/credentials";
import { hashPassword, passwordProblem } from "@/lib/passwords";
import { UserError } from "@/lib/sprint-ops";

const optional = z.preprocess((v) => (v === "" || v == null ? null : String(v).trim()), z.string().nullable());

const userFields = z.object({
  displayName: z.string().trim().min(1, "Name is required").max(100, "Name is too long"),
  username: z.string().transform(normalizeName).pipe(z.string().min(3, "User name needs at least 3 characters").max(60, "User name is too long").regex(/^[a-z0-9 ._-]+$/, "User name may use letters, digits, spaces, dots, dashes and underscores")),
  email: optional.transform((v) => (v ? v.toLowerCase() : null)).pipe(z.string().email("Enter a valid email address").nullable()),
  roleId: z.string().min(1, "Choose a role"),
  memberId: optional,
});

function fail(err: unknown): ActionState {
  if (err instanceof UserError) return { error: err.message };
  return toActionError(err);
}

/** Friendly checks for the unique fields (the database would refuse them too). */
async function assertFree(data: { username: string; email: string | null; memberId: string | null }, exceptId?: string) {
  const not = exceptId ? { id: { not: exceptId } } : {};
  if (await db.user.findFirst({ where: { username: data.username, ...not } })) throw new UserError(`The user name "${data.username}" is already taken.`);
  if (data.email && (await db.user.findFirst({ where: { email: data.email, ...not } }))) throw new UserError(`Another user already has the email ${data.email}.`);
  if (data.memberId && (await db.user.findFirst({ where: { memberId: data.memberId, ...not } }))) throw new UserError("That member already has a sign-in account.");
}

/** The app must always keep at least one active administrator. */
async function assertAdminRemains(userId: string, next: { roleId?: string; active?: boolean; deleting?: boolean }) {
  const user = await db.user.findUnique({ where: { id: userId }, include: { role: true } });
  if (!user || !user.role.builtIn || !user.active) return;
  const nextRole = next.roleId ? await db.role.findUnique({ where: { id: next.roleId } }) : user.role;
  const staysAdmin = !next.deleting && next.active !== false && Boolean(nextRole?.builtIn);
  if (staysAdmin) return;
  const others = await db.user.count({ where: { id: { not: userId }, active: true, role: { builtIn: true } } });
  if (others === 0) throw new UserError("This is the last active administrator. Make someone else an administrator first.");
}

export async function createUser(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("users.manage");
  let id: string;
  try {
    const data = userFields.parse(Object.fromEntries(formData.entries()));
    const password = String(formData.get("password") ?? "");
    const problem = passwordProblem(password, data.username);
    if (problem) return { error: `Temporary password: ${problem}` };
    if (!(await db.role.findUnique({ where: { id: data.roleId } }))) return { error: "That role no longer exists." };
    await assertFree(data);
    const user = await db.user.create({
      data: { ...data, displayName: titleCase(data.displayName), passwordHash: await hashPassword(password), mustChangePassword: true },
    });
    id = user.id;
  } catch (err) {
    return fail(err);
  }
  revalidatePath("/users");
  revalidatePath("/members", "layout");
  redirect(`/users/${id}?created=1`);
}

export async function updateUser(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const me = await requirePermission("users.manage");
  try {
    const id = String(formData.get("id"));
    const data = userFields.parse(Object.fromEntries(formData.entries()));
    const active = formData.get("active") === "on";
    if (id === me.id && !active) return { error: "You cannot disable your own account." };
    await assertFree(data, id);
    await assertAdminRemains(id, { roleId: data.roleId, active });
    const before = await db.user.findUniqueOrThrow({ where: { id } });
    await db.user.update({
      where: { id },
      // Disabling ends the user's sessions at once.
      data: { ...data, displayName: titleCase(data.displayName), active, sessionVersion: before.active && !active ? { increment: 1 } : undefined },
    });
  } catch (err) {
    return fail(err);
  }
  revalidatePath("/users", "layout");
  return { ok: true, message: "Saved." };
}

export async function resetUserPassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("users.manage");
  try {
    const id = String(formData.get("id"));
    const user = await db.user.findUnique({ where: { id } });
    if (!user) return { error: "This user no longer exists." };
    const password = String(formData.get("password") ?? "");
    const problem = passwordProblem(password, user.username);
    if (problem) return { error: problem };
    await db.user.update({
      where: { id },
      data: { passwordHash: await hashPassword(password), mustChangePassword: true, sessionVersion: { increment: 1 } },
    });
    return { ok: true, message: `Password reset. Give ${user.displayName} the temporary password; they choose their own at the next sign-in. Their open sessions were signed out.` };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteUser(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const me = await requirePermission("users.manage");
  try {
    const id = String(formData.get("id"));
    if (id === me.id) return { error: "You cannot delete your own account." };
    await assertAdminRemains(id, { deleting: true });
    await db.user.delete({ where: { id } });
  } catch (err) {
    return fail(err);
  }
  revalidatePath("/users");
  redirect("/users");
}
