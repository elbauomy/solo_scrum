import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "./db";
import { ACTIVITY_COOKIE, ACTIVITY_HEADER, SESSION_COOKIE, cookieOptions, createActivityToken, createSessionToken, readSession } from "./session";
import { isIdleExpired } from "./sign-in-security";
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
  store.set(SESSION_COOKIE, await createSessionToken(user.id, user.sessionVersion), cookieOptions());
  store.set(ACTIVITY_COOKIE, await createActivityToken(user.id, Math.floor(Date.now() / 1000)), cookieOptions());
}

export async function endSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  store.delete(ACTIVITY_COOKIE);
}

/**
 * The session, read once per request. A disabled user, a deleted user, or a session from before a password change
 * counts as nobody.
 */
const loadSession = cache(async (): Promise<{ user: CurrentUser | null; idle: boolean }> => {
  const session = await readSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session) return { user: null, idle: false };
  const user = await db.user.findUnique({
    where: { id: session.userId },
    include: { role: { include: { permissions: { select: { permission: true } } } } },
  });
  if (!user || !user.active || user.sessionVersion !== session.version) return { user: null, idle: false };
  // Idle timeout (BR-58): the previous request was longer ago than the setting.
  const last = Number((await headers()).get(ACTIVITY_HEADER) || NaN);
  const setting = await db.setting.findUnique({ where: { id: 1 }, select: { idleMinutes: true } });
  if (isIdleExpired(Number.isFinite(last) ? last : null, Date.now(), setting?.idleMinutes ?? 120)) return { user: null, idle: true };
  const isAdmin = user.role.builtIn;
  return { idle: false, user: {
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
  } };
});

/** Who is signed in (null when nobody, or when the session has been idle too long). */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  return (await loadSession()).user;
}

/** True when this request carries a session that ended because it was idle too long. */
export async function sessionWentIdle(): Promise<boolean> {
  return (await loadSession()).idle;
}

/** For pages and downloads: anyone signed in. Others go to the login page; an idle session is ended first. */
export async function requireSession(): Promise<CurrentUser> {
  const { user, idle } = await loadSession();
  if (idle) redirect("/api/auth/session-ended");
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

/** The signed-in user's ID, for "who made this change" columns (null outside a signed-in request). */
export async function actorId(): Promise<string | null> {
  try {
    return (await getCurrentUser())?.id ?? null;
  } catch {
    return null;
  }
}

/** True when the signed-in user has the permission. For server pages that show or hide a part. */
export async function can(permission: string): Promise<boolean> {
  return (await getCurrentUser())?.permissions.has(permission) ?? false;
}
