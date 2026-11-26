// Sign-in protection rules (BR-58). Pure: no database, no Next.js, so every rule is unit-tested.
import { z } from "zod";

export type SecuritySettings = { minPasswordLength: number; maxFailedSignIns: number; lockMinutes: number; idleMinutes: number };

export const SECURITY_DEFAULTS: SecuritySettings = { minPasswordLength: 8, maxFailedSignIns: 5, lockMinutes: 15, idleMinutes: 120 };

export const SECURITY_LIMITS = {
  minPasswordLength: { min: 8, max: 64, label: "Minimum password length" },
  maxFailedSignIns: { min: 3, max: 10, label: "Failed sign-ins before the account locks" },
  lockMinutes: { min: 5, max: 1440, label: "Lock duration (minutes)" },
  idleMinutes: { min: 15, max: 720, label: "End session after this many minutes without activity" },
} as const;

const whole = (key: keyof typeof SECURITY_LIMITS) => {
  const { min, max, label } = SECURITY_LIMITS[key];
  return z.coerce
    .number({ message: `${label}: enter a number` })
    .int(`${label} must be a whole number`)
    .min(min, `${label} must be between ${min} and ${max}`)
    .max(max, `${label} must be between ${min} and ${max}`);
};

/** Settings outside the allowed ranges are refused. */
export const securitySettingsSchema = z.object({
  minPasswordLength: whole("minPasswordLength"),
  maxFailedSignIns: whole("maxFailedSignIns"),
  lockMinutes: whole("lockMinutes"),
  idleMinutes: whole("idleMinutes"),
});

// ---------- passwords ----------

export const MAX_PASSWORD_LENGTH = 200;

/** The rule in plain words, shown under every password field. */
export function passwordRuleText(minLength: number): string {
  return `At least ${minLength} characters, with letters and numbers.`;
}

/** A message, or null when the new password follows the rule. "Same as current" is checked by the caller (it needs the hash). */
export function passwordProblem(password: string, minLength: number): string | null {
  if (password.length < minLength) return `Use at least ${minLength} characters.`;
  if (password.length > MAX_PASSWORD_LENGTH) return `Use at most ${MAX_PASSWORD_LENGTH} characters.`;
  if (!/\p{L}/u.test(password)) return "Include at least one letter.";
  if (!/\p{Nd}/u.test(password)) return "Include at least one number.";
  return null;
}

export const SAME_PASSWORD_MESSAGE = "Choose a password different from the current one.";

// ---------- lockout ----------

export type LockState = { failedSignIns: number; lockedUntil: Date | null };

export function isLocked(state: Pick<LockState, "lockedUntil">, now: Date): boolean {
  return state.lockedUntil != null && state.lockedUntil.getTime() > now.getTime();
}

/** After a wrong password: count it, and lock when the count reaches the setting (the count then starts again). */
export function afterFailedSignIn(state: LockState, settings: Pick<SecuritySettings, "maxFailedSignIns" | "lockMinutes">, now: Date): LockState & { lockedNow: boolean } {
  const count = state.failedSignIns + 1;
  if (count >= settings.maxFailedSignIns) {
    return { failedSignIns: 0, lockedUntil: new Date(now.getTime() + settings.lockMinutes * 60_000), lockedNow: true };
  }
  return { failedSignIns: count, lockedUntil: state.lockedUntil, lockedNow: false };
}

/** A successful sign-in, an unlock or a temporary password: everything starts again. */
export const CLEARED: LockState = { failedSignIns: 0, lockedUntil: null };

export function signInFailedMessage(settings: Pick<SecuritySettings, "maxFailedSignIns" | "lockMinutes">): string {
  return `Sign-in failed. Check your user name and password. After ${settings.maxFailedSignIns} failed attempts the account is locked for ${settings.lockMinutes} minutes.`;
}

// ---------- idle timeout ----------

/**
 * True when the previous request was longer ago than the idle limit. `lastActivity` is in seconds since 1970;
 * null means this browser has no activity mark yet (just signed in), which never counts as idle.
 */
export function isIdleExpired(lastActivity: number | null, nowMs: number, idleMinutes: number): boolean {
  if (lastActivity == null || !Number.isFinite(lastActivity)) return false;
  return nowMs - lastActivity * 1000 > idleMinutes * 60_000;
}

export function idleEndedMessage(idleMinutes: number): string {
  return `Your session ended after ${idleMinutes} minutes without activity.`;
}
