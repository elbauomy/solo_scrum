"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { type ActionState, toActionError } from "@/lib/action-state";
import { normalizePermissions } from "@/lib/permissions";
import { recordAudit } from "@/lib/audit";
import { changedFields } from "@/lib/audit-entry";

const roleFields = z.object({
  name: z.string().trim().min(1, "Name is required").max(60, "Name is too long"),
  description: z.string().trim().max(300, "Description is too long").default(""),
});

function friendly(err: unknown): ActionState {
  const res = toActionError(err);
  if (res.error?.startsWith("That name")) return { error: "Another role already has that name." };
  return res;
}

export async function createRole(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const me = await requirePermission("roles.manage");
  let id: string;
  try {
    const data = roleFields.parse(Object.fromEntries(formData.entries()));
    const permissions = normalizePermissions(formData.getAll("permission").map(String));
    const role = await db.role.create({ data: { ...data, permissions: { create: permissions.map((permission) => ({ permission })) } } });
    id = role.id;
    await recordAudit({ action: "ROLE_CREATED", user: me, record: { type: "Role", id: role.id, name: role.name }, details: { after: { ...data, permissions } } });
  } catch (err) {
    return friendly(err);
  }
  revalidatePath("/roles");
  redirect(`/roles/${id}?saved=1`);
}

export async function updateRole(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const me = await requirePermission("roles.manage");
  try {
    const id = String(formData.get("id"));
    const role = await db.role.findUnique({ where: { id }, include: { permissions: { select: { permission: true } } } });
    if (!role) return { error: "This role no longer exists." };
    if (role.builtIn) return { error: "The Administrator role always has every permission and cannot be changed." };
    const had = role.permissions.map((p) => p.permission);
    const data = roleFields.parse(Object.fromEntries(formData.entries()));
    const permissions = normalizePermissions(formData.getAll("permission").map(String));
    await db.$transaction([
      db.role.update({ where: { id }, data }),
      db.rolePermission.deleteMany({ where: { roleId: id } }),
      db.rolePermission.createMany({ data: permissions.map((permission) => ({ roleId: id, permission })) }),
    ]);
    const record = { type: "Role", id, name: data.name };
    const diff = changedFields({ name: role.name, description: role.description }, data);
    if (diff) await recordAudit({ action: "ROLE_UPDATED", user: me, record, details: diff });
    const added = permissions.filter((p) => !had.includes(p));
    const removed = had.filter((p) => !permissions.includes(p));
    if (added.length || removed.length) await recordAudit({ action: "ROLE_PERMISSIONS_CHANGED", user: me, record, details: { added, removed, before: { permissions: had }, after: { permissions } } });
  } catch (err) {
    return friendly(err);
  }
  revalidatePath("/", "layout");
  return { ok: true, message: "Saved. Users with this role get the new permissions straight away." };
}

export async function deleteRole(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const me = await requirePermission("roles.manage");
  try {
    const id = String(formData.get("id"));
    const role = await db.role.findUnique({ where: { id }, include: { _count: { select: { users: true } } } });
    if (!role) return { error: "This role no longer exists." };
    if (role.builtIn) return { error: "The Administrator role cannot be deleted." };
    if (role._count.users > 0) return { error: `${role._count.users} user(s) still have this role. Give them another role first.` };
    const perms = await db.rolePermission.findMany({ where: { roleId: id }, select: { permission: true } });
    await db.role.delete({ where: { id } });
    await recordAudit({ action: "ROLE_DELETED", user: me, record: { type: "Role", id, name: role.name }, details: { before: { name: role.name, description: role.description, permissions: perms.map((p) => p.permission) } } });
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath("/roles");
  redirect("/roles");
}
