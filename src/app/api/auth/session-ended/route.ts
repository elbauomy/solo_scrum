import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { ACTIVITY_COOKIE, SESSION_COOKIE, readSession } from "@/lib/session";

/** Ends a session that was idle too long: records it, clears both cookies and goes to the sign-in page. */
export async function GET(req: NextRequest) {
  const session = await readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (session) {
    const user = await db.user.findUnique({ where: { id: session.userId }, select: { id: true, displayName: true, sessionVersion: true } });
    if (user && user.sessionVersion === session.version) {
      await recordAudit({ action: "SESSION_EXPIRED", user, record: { type: "User", id: user.id, name: user.displayName } });
    }
  }
  const res = NextResponse.redirect(new URL("/login?ended=idle", req.url));
  res.cookies.delete(SESSION_COOKIE);
  res.cookies.delete(ACTIVITY_COOKIE);
  return res;
}
