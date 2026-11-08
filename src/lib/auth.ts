import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "./db";
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, createSessionToken, readSession } from "./session";
import { ForbiddenError } from "./forbidden";
import { ALL_PERMISSIONS, firstAllowedPath, hasAny } from "./permissions";

export type CurrentUser = {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  roleName: string;
  isAdmin: boolean;
  permissions: ReadonlySet<string>;
  mustChangePassword: boolean;
  hasPassword: boolean;
  memberId: string | null;
};

export async function startSession(user: { id: string; sessionVersion: number }): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, await createSessionToken(user.id, user.sessionVersion), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function endSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

/**
 * Who is signed in (null when nobody). Read once per request. A disabled user, a deleted user, or a session from
 * before a password change counts as nobody.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await readSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session) return null;
  const user = await db.user.findUnique({
    where: { id: session.userId },
    include: { role: { include: { permissions: { select: { permission: true } } } } },
  });
  if (!user || !user.active || user.sessionVersion !== session.version) return null;
  const isAdmin = user.role.builtIn;
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    email: user.email,
    roleName: user.role.name,
    isAdmin,
    permissions: new Set(isAdmin ? ALL_PERMISSIONS : user.role.permissions.map((p) => p.permission)),
    mustChangePassword: user.mustChangePassword,
    hasPassword: Boolean(user.passwordHash),
    memberId: user.memberId,
  };
});

/** For pages and downloads: anyone signed in. Others go to the login page. */
export async function requireSession(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * Call first in every Server Action. Passes when the user has at least one of the permissions;
 * someone not signed in goes to the login page, anyone else is refused.
 */
export async function requirePermission(...anyOf: string[]): Promise<CurrentUser> {
  const user = await requireSession();
  if (user.mustChangePassword || !hasAny(user.permissions, anyOf)) throw new ForbiddenError();
  return user;
}

/** For pages: without the permission, go to the first page this user may open. */
export async function requirePageAccess(...anyOf: string[]): Promise<CurrentUser> {
  const user = await requireSession();
  if (!hasAny(user.permissions, anyOf)) redirect(firstAllowedPath(user.permissions));
  return user;
}

/** True when the signed-in user has the permission. For server pages that show or hide a part. */
export async function can(permission: string): Promise<boolean> {
  return (await getCurrentUser())?.permissions.has(permission) ?? false;
}
