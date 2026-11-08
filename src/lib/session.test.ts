import { beforeAll, describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import { createSessionToken, isValidSessionToken, readSession } from "./session";

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-1234";
});

describe("session token", () => {
  it("carries the user id and session version", async () => {
    const token = await createSessionToken("user-1", 3);
    expect(await readSession(token)).toEqual({ userId: "user-1", version: 3 });
    expect(await isValidSessionToken(token)).toBe(true);
  });

  it("rejects missing, forged and tampered tokens", async () => {
    expect(await readSession(undefined)).toBeNull();
    expect(await readSession("not-a-token")).toBeNull();
    const token = await createSessionToken("user-1", 1);
    const [h, , sig] = token.split(".");
    const forgedBody = Buffer.from(JSON.stringify({ uid: "admin", v: 1 })).toString("base64url");
    expect(await readSession(`${h}.${forgedBody}.${sig}`)).toBeNull();
    const otherKey = new TextEncoder().encode("another-secret-another-secret-another-1");
    const signedElsewhere = await new SignJWT({ uid: "user-1", v: 1 }).setProtectedHeader({ alg: "HS256" }).sign(otherKey);
    expect(await readSession(signedElsewhere)).toBeNull();
  });

  it("does not accept tokens from the old two-account sign-in", async () => {
    const key = new TextEncoder().encode(process.env.SESSION_SECRET);
    const old = await new SignJWT({ role: "admin", name: "khaled elbauomy" }).setProtectedHeader({ alg: "HS256" }).sign(key);
    expect(await readSession(old)).toBeNull();
  });

  it("rejects expired tokens", async () => {
    const key = new TextEncoder().encode(process.env.SESSION_SECRET);
    const expired = await new SignJWT({ uid: "u", v: 1 }).setProtectedHeader({ alg: "HS256" }).setExpirationTime(Math.floor(Date.now() / 1000) - 10).sign(key);
    expect(await readSession(expired)).toBeNull();
  });
});
