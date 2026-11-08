import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, isValidSessionToken } from "@/lib/session";

// Sends anyone without a valid session cookie to /login. Whether that user is still active, and what they may open,
// is checked on the page itself (the database is not reachable from here).
const PUBLIC = ["/login", "/api/auth/microsoft/start", "/api/auth/microsoft/callback"];

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (!PUBLIC.includes(path) && !(await isValidSessionToken(request.cookies.get(SESSION_COOKIE)?.value))) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  // Lets the layout know which page is open (used to send users with a temporary password to their profile).
  const headers = new Headers(request.headers);
  headers.set("x-pathname", path);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|brand/).*)"],
};
