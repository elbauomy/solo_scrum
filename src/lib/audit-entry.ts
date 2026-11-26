// Audit log rules (BR-57). Pure: no database, no Next.js, so every rule is unit-tested.

export const AUDIT_ACTIONS = {
  SIGN_IN_SUCCESS: "Signed in",
  SIGN_IN_FAILED: "Sign-in failed",
  ACCOUNT_LOCKED: "Account locked",
  ACCOUNT_UNLOCKED: "Account unlocked",
  SIGN_OUT: "Signed out",
  SESSION_EXPIRED: "Session ended (idle)",
  PASSWORD_CHANGED: "Password changed",
  PASSWORD_RESET: "Temporary password set",
  USER_CREATED: "User created",
  USER_UPDATED: "User updated",
  USER_DISABLED: "User disabled",
  USER_ENABLED: "User enabled",
  USER_DELETED: "User deleted",
  ROLE_CREATED: "Role created",
  ROLE_UPDATED: "Role updated",
  ROLE_DELETED: "Role deleted",
  ROLE_PERMISSIONS_CHANGED: "Role permissions changed",
  SETTINGS_CHANGED: "Settings changed",
  BACKUP_DOWNLOADED: "Full backup downloaded",
  WORK_ITEMS_IMPORTED: "Work items imported",
  PLANNING_SHEET_IMPORTED: "Planning sheet imported",
  BULK_DELETE: "Bulk delete",
  STANDUP_FILLED_FROM_TEAMS: "Standup filled from Teams",
  TEAMS_FETCH_FAILED: "Teams fetch failed",
  AUDIT_LOG_EXPORTED: "Audit log exported",
} as const;

export type AuditAction = keyof typeof AUDIT_ACTIONS;
export const AUDIT_ACTION_CODES = Object.keys(AUDIT_ACTIONS) as AuditAction[];

export type AuditInput = {
  action: AuditAction;
  /** The signed-in user; leave empty for a failed sign-in */
  user?: { id: string; displayName: string } | null;
  /** The user name as typed, for a failed sign-in */
  typedUsername?: string | null;
  record?: { type: string; id?: string | null; name?: string | null } | null;
  /** Anything useful; for changes use { before, after }. Secrets are removed automatically. */
  details?: unknown;
  ip?: string | null;
};

export type AuditRow = {
  userId: string | null;
  userName: string | null;
  typedUsername: string | null;
  action: AuditAction;
  recordType: string | null;
  recordId: string | null;
  recordName: string | null;
  details: string | null;
  ip: string | null;
};

const SECRET_KEY = /pass(word)?|hash|token|secret|cookie|session|credential|authorization|api[_-]?key/i;
export const REDACTED = "[removed]";

/** Removes every value whose key looks like a secret, at any depth. Never throws. */
export function scrubSecrets(value: unknown, depth = 0): unknown {
  if (depth > 8) return null;
  if (Array.isArray(value)) return value.map((v) => scrubSecrets(v, depth + 1));
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY.test(k) ? REDACTED : scrubSecrets(v, depth + 1);
    }
    return out;
  }
  if (typeof value === "bigint") return value.toString();
  return value;
}

const cut = (v: string | null | undefined, n: number) => (v == null ? null : String(v).slice(0, n));

/** The row to store for one action. */
export function buildAuditEntry(input: AuditInput): AuditRow {
  if (!(input.action in AUDIT_ACTIONS)) throw new Error(`Unknown audit action: ${input.action}`);
  const details = input.details === undefined || input.details === null ? null : JSON.stringify(scrubSecrets(input.details));
  return {
    userId: input.user?.id ?? null,
    userName: cut(input.user?.displayName, 200),
    typedUsername: cut(input.typedUsername, 100),
    action: input.action,
    recordType: cut(input.record?.type, 50),
    recordId: cut(input.record?.id, 100),
    recordName: cut(input.record?.name, 300),
    details: details && details.length > 100_000 ? JSON.stringify({ note: "Details were too long to keep." }) : details,
    ip: cut(input.ip, 100),
  };
}

/** The first address in X-Forwarded-For, else X-Real-IP. */
export function clientIp(get: (name: string) => string | null): string | null {
  const fwd = get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim() || null;
  return get("x-real-ip")?.trim() || null;
}

/** Only the fields that changed, as { before, after }. */
export function changedFields<T extends Record<string, unknown>>(before: T, after: Partial<T>): { before: Partial<T>; after: Partial<T> } | null {
  const b: Partial<T> = {};
  const a: Partial<T> = {};
  for (const key of Object.keys(after) as (keyof T)[]) {
    const x = before[key];
    const y = after[key];
    const same = x instanceof Date && y instanceof Date ? x.getTime() === y.getTime() : JSON.stringify(x) === JSON.stringify(y);
    if (!same) {
      b[key] = x;
      a[key] = y as T[keyof T];
    }
  }
  return Object.keys(a).length ? { before: b, after: a } : null;
}

// ---------- reading ----------

export const AUDIT_PAGE_SIZE = 50;
export const CAIRO = "Africa/Cairo";

export type AuditFilters = { from?: string; to?: string; user?: string; action?: string; page?: string };

/** Today's date in Cairo as YYYY-MM-DD. */
export function cairoDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: CAIRO, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** The UTC instant at which a Cairo calendar day starts (handles summer time). */
export function cairoDayStart(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  // Offset of Cairo from UTC at that moment, in minutes.
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: CAIRO, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(new Date(guess));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  const offset = (asUtc - guess) / 60000;
  return new Date(guess - offset * 60000);
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Turns the page's filters into a date range (default: the last 7 days in Cairo time) plus user and action. */
export function auditQuery(f: AuditFilters, now: Date = new Date()) {
  const today = cairoDate(now);
  const to = f.to && DAY.test(f.to) ? f.to : today;
  const defaultFrom = cairoDate(new Date(cairoDayStart(to).getTime() - 6 * 86_400_000 + 12 * 3_600_000));
  const from = f.from && DAY.test(f.from) ? f.from : defaultFrom;
  const start = cairoDayStart(from);
  const end = cairoDayStart(cairoDate(new Date(cairoDayStart(to).getTime() + 36 * 3_600_000)));
  const action = f.action && f.action in AUDIT_ACTIONS ? (f.action as AuditAction) : undefined;
  const user = f.user && f.user.length <= 100 ? f.user : undefined;
  const page = Math.max(1, Math.min(100_000, Number.parseInt(f.page ?? "1", 10) || 1));
  return {
    from,
    to,
    page,
    where: {
      at: { gte: start, lt: end },
      ...(user ? { userId: user } : {}),
      ...(action ? { action } : {}),
    },
  };
}

/** "26 Nov 2026, 14:05" in Cairo time. */
export function formatCairo(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: CAIRO, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
}
