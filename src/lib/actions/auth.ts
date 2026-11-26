"use server";

import { redirect } from "next/navigation";
import { endSession, getCurrentUser, startSession } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/passwords";
import { bootstrapUsersFromEnv, findUserByLogin } from "@/lib/users";
import type { ActionState } from "@/lib/action-state";

export async function login(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const identifier = String(formData.get("username") ?? "").slice(0, 200);
  const password = String(formData.get("password") ?? "").slice(0, 500);
  await bootstrapUsersFromEnv();
  const user = await findUserByLogin(identifier);
  // The password is always checked (against a dummy when the user does not exist), so timing does not reveal user names.
  const ok = (await verifyPassword(password, user?.passwordHash)) && password.length > 0;
  if (!user || !ok || !user.active) {
    await recordAudit({
      action: "SIGN_IN_FAILED",
      typedUsername: identifier,
      record: user ? { type: "User", id: user.id, name: user.displayName } : null,
      details: { reason: !user ? "unknown user name" : !user.active ? "account disabled" : "wrong password" },
    });
    await new Promise((r) => setTimeout(r, 800));
    return { error: "Wrong user name or password." };
  }
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
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
