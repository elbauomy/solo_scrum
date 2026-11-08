import { NextResponse } from "next/server";
import { SSO_COOKIE, ssoConfig, startSignIn } from "@/lib/sso";

export async function GET(req: Request) {
  const cfg = ssoConfig();
  if (!cfg) return NextResponse.redirect(new URL("/login?sso=off", req.url));
  const { url, cookie } = await startSignIn(cfg);
  const res = NextResponse.redirect(url);
  res.cookies.set(SSO_COOKIE, cookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth/microsoft",
    maxAge: 600,
  });
  return res;
}
