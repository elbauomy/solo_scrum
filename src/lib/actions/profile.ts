"use server";

import { redirect } from "next/navigation";
import { requireSession, startSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { type ActionState, toActionError } from "@/lib/action-state";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/passwords";
import { firstAllowedPath } from "@/lib/permissions";

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
    if (user.passwordHash && current === next) return { error: "Choose a password different from the current one." };
    const problem = passwordProblem(next, user.username);
    if (problem) return { error: problem };
    wasTemporary = user.mustChangePassword;
    const updated = await db.user.update({
      where: { id: me.id },
      data: { passwordHash: await hashPassword(next), mustChangePassword: false, sessionVersion: { increment: 1 } },
    });
    await startSession(updated);
  } catch (err) {
    return toActionError(err);
  }
  if (wasTemporary) redirect(firstAllowedPath(me.permissions));
  return { ok: true, message: "Password changed. You stay signed in here; other devices were signed out." };
}
