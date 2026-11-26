"use server";

import { redirect } from "next/navigation";
import { requireSession, startSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { type ActionState, toActionError } from "@/lib/action-state";
import { hashPassword, verifyPassword } from "@/lib/passwords";
import { SAME_PASSWORD_MESSAGE, passwordProblem } from "@/lib/sign-in-security";
import { getSecuritySettings } from "@/lib/settings";
import { firstAllowedPath } from "@/lib/permissions";
import { recordAudit } from "@/lib/audit";

/** Any signed-in user changes their own password. Other open sessions of this user are signed out. */
export async function changePassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const me = await requireSession();
  let wasTemporary = false;
  try {
    const current = String(formData.get("current") ?? "");
    const next = String(formData.get("next") ?? "");
    const confirm = String(formData.get("confirm") ?? "");
    const user = await db.user.findUniqueOrThrow({ where: { id: me.id } });
    if (user.passwordHash && !(await verifyPassword(current, user.passwordHash))) {
      await new Promise((r) => setTimeout(r, 600));
      return { error: "Your current password is not right." };
    }
    if (next !== confirm) return { error: "The two new passwords are not the same." };
    if (user.passwordHash && current === next) return { error: SAME_PASSWORD_MESSAGE };
    const problem = passwordProblem(next, (await getSecuritySettings()).minPasswordLength);
    if (problem) return { error: problem };
    wasTemporary = user.mustChangePassword;
    const updated = await db.user.update({
      where: { id: me.id },
      data: { passwordHash: await hashPassword(next), mustChangePassword: false, sessionVersion: { increment: 1 } },
    });
    await startSession(updated);
    await recordAudit({ action: "PASSWORD_CHANGED", user: me, record: { type: "User", id: me.id, name: me.displayName }, details: { atFirstSignIn: wasTemporary } });
  } catch (err) {
    return toActionError(err);
  }
  if (wasTemporary) redirect(firstAllowedPath(me.permissions));
  return { ok: true, message: "Password changed. You stay signed in here; other devices were signed out." };
}
