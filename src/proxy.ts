import { NextResponse, type NextRequest } from "next/server";
import { ACTIVITY_COOKIE, ACTIVITY_HEADER, SESSION_COOKIE, cookieOptions, createActivityToken, readActivity, readSession } from "@/lib/session";

// Sends anyone without a valid session cookie to /login. Whether that user is still active, idle, and what they may
// open, is checked on the page itself (the database is not reachable from here).
const PUBLIC = ["/login", "/api/auth/microsoft/start", "/api/auth/microsoft/callback", "/api/auth/session-ended"];

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const session = await readSession(request.cookies.get(SESSION_COOKIE)?.value);
  if (!PUBLIC.includes(path) && !session) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  const headers = new Headers(request.headers);
  // Lets the layout know which page is open (used to send users with a temporary password to their profile).
  headers.set("x-pathname", path);
  // The previous activity time goes to the page, which decides whether the session has been idle too long.
  // Never trust a value sent by the browser.
  headers.delete(ACTIVITY_HEADER);
  if (session) {
    const seen = await readActivity(request.cookies.get(ACTIVITY_COOKIE)?.value);
    if (seen && seen.userId === session.userId) headers.set(ACTIVITY_HEADER, String(seen.at));
  }
  const res = NextResponse.next({ request: { headers } });
  // Every request renews the activity time.
  if (session && path !== "/api/auth/session-ended") {
    res.cookies.set(ACTIVITY_COOKIE, await createActivityToken(session.userId, Math.floor(Date.now() / 1000)), cookieOptions());
  }
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|brand/).*)"],
};
