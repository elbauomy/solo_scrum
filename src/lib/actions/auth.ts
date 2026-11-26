"use server";

import { redirect } from "next/navigation";
import { endSession, getCurrentUser, startSession } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/passwords";
import { getSecuritySettings } from "@/lib/settings";
import { CLEARED, afterFailedSignIn, isLocked, signInFailedMessage } from "@/lib/sign-in-security";
import { bootstrapUsersFromEnv, findUserByLogin } from "@/lib/users";
import type { ActionState } from "@/lib/action-state";

export async function login(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const identifier = String(formData.get("username") ?? "").slice(0, 200);
  const password = String(formData.get("password") ?? "").slice(0, 500);
  await bootstrapUsersFromEnv();
  const settings = await getSecuritySettings();
  const user = await findUserByLogin(identifier);
  // The password is always checked (against a dummy when the user does not exist), so timing does not reveal user names.
  const passwordOk = (await verifyPassword(password, user?.passwordHash)) && password.length > 0;
  const now = new Date();

  const failed = async (reason: string) => {
    await recordAudit({
      action: "SIGN_IN_FAILED",
      typedUsername: identifier,
      record: user ? { type: "User", id: user.id, name: user.displayName } : null,
      details: { reason },
    });
    await new Promise((r) => setTimeout(r, 800));
    // The same message whatever went wrong.
    return { error: signInFailedMessage(settings) };
  };

  if (!user) return failed("unknown user name");
  if (isLocked(user, now)) return failed("account locked");
  if (!user.active) return failed("account disabled");
  if (!passwordOk) {
    const next = afterFailedSignIn(user, settings, now);
    await db.user.update({ where: { id: user.id }, data: { failedSignIns: next.failedSignIns, lockedUntil: next.lockedUntil } });
    if (next.lockedNow) {
      await recordAudit({
        action: "ACCOUNT_LOCKED",
        record: { type: "User", id: user.id, name: user.displayName },
        details: { failedSignIns: settings.maxFailedSignIns, lockedUntil: next.lockedUntil, lockMinutes: settings.lockMinutes },
      });
    }
    return failed("wrong password");
  }

  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: now, ...CLEARED } });
  await recordAudit({ action: "SIGN_IN_SUCCESS", user, record: { type: "User", id: user.id, name: user.displayName }, details: { method: "password" } });
  await startSession(user);
  redirect(user.mustChangePassword ? "/profile" : "/");
}

export async function logout(): Promise<void> {
  const me = await getCurrentUser();
  if (me) await recordAudit({ action: "SIGN_OUT", user: me, record: { type: "User", id: me.id, name: me.displayName } });
  await endSession();
  redirect("/login");
}
