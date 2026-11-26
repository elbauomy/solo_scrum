"use server";

import { redirect } from "next/navigation";
import { endSession, startSession } from "@/lib/auth";
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
    await new Promise((r) => setTimeout(r, 800));
    return { error: "Wrong user name or password." };
  }
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await startSession(user);
  redirect(user.mustChangePassword ? "/profile" : "/");
}

export async function logout(): Promise<void> {
  await endSession();
  redirect("/login");
}
