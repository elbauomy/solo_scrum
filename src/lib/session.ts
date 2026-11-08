// Session token helpers. Safe to use from proxy.ts (no Node-only imports).
// The token only says WHO is signed in (user id + session version). What they may do is read from the database
// on every request, so a role or permission change applies at once.
import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "act_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

function secretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be set and at least 32 characters long");
  }
  return new TextEncoder().encode(secret);
}

export type SessionData = { userId: string; version: number };

export async function createSessionToken(userId: string, version: number): Promise<string> {
  return new SignJWT({ uid: userId, v: version })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(secretKey());
}

/** The signed-in user id and session version, or null when the token is missing, forged, expired or from the old two-account sign-in. */
export async function readSession(token: string | undefined): Promise<SessionData | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    if (typeof payload.uid !== "string" || !payload.uid || typeof payload.v !== "number") return null;
    return { userId: payload.uid, version: payload.v };
  } catch {
    return null;
  }
}

export async function isValidSessionToken(token: string | undefined): Promise<boolean> {
  return (await readSession(token)) != null;
}
