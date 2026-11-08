import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { startSession } from "@/lib/auth";
import { SSO_COOKIE, SsoError, finishSignIn, ssoConfig } from "@/lib/sso";

export async function GET(req: NextRequest) {
  const cfg = ssoConfig();
  const back = (code: string) => {
    const res = NextResponse.redirect(new URL(`/login?sso=${code}`, cfg?.appUrl ?? req.url));
    res.cookies.delete({ name: SSO_COOKIE, path: "/api/auth/microsoft" });
    return res;
  };
  if (!cfg) return back("off");
  let email: string;
  try {
    ({ email } = await finishSignIn(cfg, req.nextUrl.searchParams, req.cookies.get(SSO_COOKIE)?.value));
  } catch (err) {
    return back(err instanceof SsoError ? err.code : "failed");
  }
  const user = await db.user.findFirst({ where: { email } });
  if (!user || !user.active) return back("no-account");
  // Someone given a temporary password who signs in with Microsoft does not need it: it is removed, so nobody else can use it.
  const updated = await db.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date(), ...(user.mustChangePassword ? { passwordHash: null, mustChangePassword: false, sessionVersion: { increment: 1 } } : {}) },
  });
  await startSession(updated);
  const res = NextResponse.redirect(new URL("/", cfg.appUrl));
  res.cookies.delete({ name: SSO_COOKIE, path: "/api/auth/microsoft" });
  return res;
}
