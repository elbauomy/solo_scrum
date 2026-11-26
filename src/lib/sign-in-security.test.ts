import { describe, expect, it } from "vitest";
import {
  CLEARED, SECURITY_DEFAULTS, afterFailedSignIn, idleEndedMessage, isIdleExpired, isLocked, passwordProblem, passwordRuleText,
  securitySettingsSchema, signInFailedMessage,
} from "./sign-in-security";

const s = SECURITY_DEFAULTS;
const now = new Date("2026-11-27T10:00:00Z");

describe("password rule", () => {
  it("needs the minimum length, a letter and a number", () => {
    expect(passwordProblem("abc12", 8)).toMatch(/at least 8 characters/);
    expect(passwordProblem("abcdefgh", 8)).toMatch(/number/);
    expect(passwordProblem("12345678", 8)).toMatch(/letter/);
    expect(passwordProblem("sprint62go", 8)).toBeNull();
    expect(passwordProblem("sprint62", 10)).toMatch(/at least 10/);
    expect(passwordProblem("a1".repeat(101), 8)).toMatch(/at most 200/);
  });
  it("is shown in plain words", () => {
    expect(passwordRuleText(8)).toBe("At least 8 characters, with letters and numbers.");
  });
});

describe("lockout", () => {
  it("counts wrong passwords and locks at the setting, then starts the count again", () => {
    let state = { ...CLEARED };
    for (let i = 1; i < s.maxFailedSignIns; i++) {
      const r = afterFailedSignIn(state, s, now);
      expect(r.lockedNow).toBe(false);
      expect(r.failedSignIns).toBe(i);
      state = r;
    }
    const locked = afterFailedSignIn(state, s, now);
    expect(locked.lockedNow).toBe(true);
    expect(locked.failedSignIns).toBe(0);
    expect(locked.lockedUntil!.toISOString()).toBe("2026-11-27T10:15:00.000Z");
  });

  it("stays locked until the time passes, even for the right password", () => {
    const state = { failedSignIns: 0, lockedUntil: new Date("2026-11-27T10:15:00Z") };
    expect(isLocked(state, new Date("2026-11-27T10:14:59Z"))).toBe(true);
    expect(isLocked(state, new Date("2026-11-27T10:15:00Z"))).toBe(false);
    expect(isLocked({ lockedUntil: null }, now)).toBe(false);
  });

  it("resets on success and on unlock", () => {
    expect(CLEARED).toEqual({ failedSignIns: 0, lockedUntil: null });
  });

  it("uses the numbers from Settings in the message", () => {
    expect(signInFailedMessage({ maxFailedSignIns: 3, lockMinutes: 30 })).toBe(
      "Sign-in failed. Check your user name and password. After 3 failed attempts the account is locked for 30 minutes.",
    );
  });
});

describe("idle timeout", () => {
  const t = Date.parse("2026-11-27T12:00:00Z");
  const secs = (ms: number) => Math.floor(ms / 1000);
  it("ends the session once the idle time has passed", () => {
    expect(isIdleExpired(secs(t - 120 * 60_000), t, 120)).toBe(false);
    expect(isIdleExpired(secs(t - 120 * 60_000 - 1000), t, 120)).toBe(true);
    expect(isIdleExpired(secs(t - 16 * 60_000), t, 15)).toBe(true);
  });
  it("each request renews it, and a fresh sign-in is never idle", () => {
    expect(isIdleExpired(secs(t - 1000), t, 15)).toBe(false);
    expect(isIdleExpired(null, t, 15)).toBe(false);
    expect(isIdleExpired(Number.NaN, t, 15)).toBe(false);
  });
  it("says why the session ended", () => {
    expect(idleEndedMessage(120)).toBe("Your session ended after 120 minutes without activity.");
  });
});

describe("settings", () => {
  it("accepts the defaults and the edges of each range", () => {
    expect(securitySettingsSchema.parse({ minPasswordLength: "8", maxFailedSignIns: "5", lockMinutes: "15", idleMinutes: "120" })).toEqual(SECURITY_DEFAULTS);
    expect(securitySettingsSchema.safeParse({ minPasswordLength: 64, maxFailedSignIns: 10, lockMinutes: 1440, idleMinutes: 720 }).success).toBe(true);
    expect(securitySettingsSchema.safeParse({ minPasswordLength: 8, maxFailedSignIns: 3, lockMinutes: 5, idleMinutes: 15 }).success).toBe(true);
  });
  it("refuses values outside the allowed ranges", () => {
    const base = { minPasswordLength: 8, maxFailedSignIns: 5, lockMinutes: 15, idleMinutes: 120 };
    for (const bad of [{ minPasswordLength: 7 }, { minPasswordLength: 65 }, { maxFailedSignIns: 2 }, { maxFailedSignIns: 11 }, { lockMinutes: 4 }, { lockMinutes: 1441 }, { idleMinutes: 14 }, { idleMinutes: 721 }, { idleMinutes: 30.5 }]) {
      expect(securitySettingsSchema.safeParse({ ...base, ...bad }).success).toBe(false);
    }
  });
});
