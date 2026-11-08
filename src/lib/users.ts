import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "./db";
import { accountsFromEnv, displayName, normalizeName } from "./credentials";
import { hashPassword } from "./passwords";
import { VIEWER_PERMISSIONS } from "./permissions";

export const ADMIN_ROLE_NAME = "Administrator";
export const VIEWER_ROLE_NAME = "Viewer";

/** The Administrator role (all permissions, cannot be changed) and a starting Viewer role, created once. */
export async function ensureBuiltInRoles(): Promise<{ adminRoleId: string; viewerRoleId: string | null }> {
  let admin = await db.role.findFirst({ where: { builtIn: true } });
  if (!admin) {
    try {
      admin = await db.role.create({ data: { name: ADMIN_ROLE_NAME, description: "Every permission. Cannot be changed or deleted.", builtIn: true } });
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
      admin = await db.role.findFirstOrThrow({ where: { builtIn: true } });
    }
  }
  let viewer = await db.role.findUnique({ where: { name: VIEWER_ROLE_NAME } });
  if (!viewer && (await db.role.count()) === 1) {
    try {
      viewer = await db.role.create({
        data: {
          name: VIEWER_ROLE_NAME,
          description: "Sees every page and downloads reports and the backup. Changes nothing.",
          permissions: { create: VIEWER_PERMISSIONS.map((permission) => ({ permission })) },
        },
      });
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
      viewer = await db.role.findUnique({ where: { name: VIEWER_ROLE_NAME } });
    }
  }
  return { adminRoleId: admin.id, viewerRoleId: viewer?.id ?? null };
}

/**
 * First sign-in after the update: there are no users yet, so the two accounts from the environment
 * (APP_PASSWORD, VIEWER_PASSWORD) become real users with their current passwords. After that the environment
 * passwords are no longer used; users are managed on the Users page.
 */
export async function bootstrapUsersFromEnv(): Promise<void> {
  if ((await db.user.count()) > 0) return;
  const { adminRoleId, viewerRoleId } = await ensureBuiltInRoles();
  for (const account of accountsFromEnv(process.env)) {
    if (!account.password) continue;
    const roleId = account.role === "admin" ? adminRoleId : viewerRoleId;
    if (!roleId) continue;
    try {
      await db.user.create({
        data: {
          username: normalizeName(account.username),
          displayName: displayName(account.username),
          passwordHash: await hashPassword(account.password),
          roleId,
        },
      });
    } catch (err) {
      // Two sign-ins at the same moment: the other one created it.
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
    }
  }
}

/** A user found by user name or email (both case-insensitive). */
export async function findUserByLogin(identifier: string) {
  const value = normalizeName(identifier);
  if (!value) return null;
  return db.user.findFirst({ where: value.includes("@") ? { email: value } : { username: value } });
}
