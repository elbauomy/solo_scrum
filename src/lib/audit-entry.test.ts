import { describe, expect, it } from "vitest";
import {
  AUDIT_ACTION_CODES, AUDIT_ACTIONS, REDACTED, auditQuery, buildAuditEntry, cairoDate, cairoDayStart, changedFields, clientIp, formatCairo,
  scrubSecrets, type AuditAction,
} from "./audit-entry";

const admin = { id: "u1", displayName: "Khaled Elbauomy" };

describe("audit entries", () => {
  it("has the 25 action codes from the requirements, each with a label", () => {
    expect(AUDIT_ACTION_CODES).toHaveLength(25);
    for (const code of AUDIT_ACTION_CODES) expect(AUDIT_ACTIONS[code].length).toBeGreaterThan(0);
  });

  it("builds an entry for every action code", () => {
    for (const action of AUDIT_ACTION_CODES) {
      const row = buildAuditEntry({ action, user: admin, record: { type: "User", id: "x", name: "Remoon" }, details: { a: 1 }, ip: "10.0.0.1" });
      expect(row).toMatchObject({ action, userId: "u1", userName: "Khaled Elbauomy", recordType: "User", recordId: "x", recordName: "Remoon", ip: "10.0.0.1" });
      expect(JSON.parse(row.details!)).toEqual({ a: 1 });
    }
  });

  it("refuses unknown action codes", () => {
    expect(() => buildAuditEntry({ action: "NOPE" as AuditAction })).toThrow(/Unknown audit action/);
  });

  it("never stores a password, hash, token or secret, at any depth", () => {
    const row = buildAuditEntry({
      action: "USER_UPDATED",
      user: admin,
      details: {
        before: { password: "old-pass-1", passwordHash: "scrypt$abc", displayName: "A" },
        after: { newPassword: "Secret-2026", displayName: "B", nested: [{ sessionToken: "jwt", clientSecret: "s", apiKey: "k", note: "ok" }] },
        Authorization: "Bearer x",
      },
    });
    const text = row.details!;
    for (const secret of ["old-pass-1", "scrypt$abc", "Secret-2026", "jwt", "Bearer x", '"s"', '"k"']) expect(text).not.toContain(secret);
    const d = JSON.parse(text);
    expect(d.before.password).toBe(REDACTED);
    expect(d.after.displayName).toBe("B");
    expect(d.after.nested[0].note).toBe("ok");
  });

  it("keeps the typed user name of a failed sign-in, cut to 100 characters, with no user", () => {
    const typed = "x".repeat(150);
    const row = buildAuditEntry({ action: "SIGN_IN_FAILED", typedUsername: typed, details: { reason: "wrong password" } });
    expect(row.userId).toBeNull();
    expect(row.typedUsername).toHaveLength(100);
    expect(scrubSecrets({ when: new Date("2026-11-26T08:00:00Z") })).toEqual({ when: "2026-11-26T08:00:00.000Z" });
  });

  it("lists only the fields that changed", () => {
    expect(changedFields({ a: 1, b: "x", c: [1, 2] }, { a: 1, b: "y", c: [1, 2] })).toEqual({ before: { b: "x" }, after: { b: "y" } });
    expect(changedFields({ a: 1 }, { a: 1 })).toBeNull();
  });

  it("reads the client address from the proxy headers", () => {
    const h = (m: Record<string, string>) => (n: string) => m[n] ?? null;
    expect(clientIp(h({ "x-forwarded-for": "41.33.1.2, 10.0.0.5" }))).toBe("41.33.1.2");
    expect(clientIp(h({ "x-real-ip": "10.1.1.1" }))).toBe("10.1.1.1");
    expect(clientIp(h({}))).toBeNull();
  });
});

describe("audit filters and Cairo time", () => {
  const now = new Date("2026-11-26T10:00:00Z"); // 12:00 in Cairo (UTC+2 in winter)

  it("knows Cairo's date and the UTC instant its day starts, in winter and in summer time", () => {
    expect(cairoDate(new Date("2026-11-25T22:30:00Z"))).toBe("2026-11-26");
    expect(cairoDayStart("2026-11-26").toISOString()).toBe("2026-11-25T22:00:00.000Z");
    expect(cairoDayStart("2026-07-15").toISOString()).toBe("2026-07-14T21:00:00.000Z");
    expect(formatCairo(new Date("2026-11-26T10:05:00Z"))).toBe("26 Nov 2026, 12:05");
  });

  it("defaults to the last 7 days, page 1", () => {
    const q = auditQuery({}, now);
    expect(q.from).toBe("2026-11-20");
    expect(q.to).toBe("2026-11-26");
    expect(q.page).toBe(1);
    expect(q.where.at.gte.toISOString()).toBe("2026-11-19T22:00:00.000Z");
    expect(q.where.at.lt.toISOString()).toBe("2026-11-26T22:00:00.000Z");
    expect(q.where).not.toHaveProperty("userId");
    expect(q.where).not.toHaveProperty("action");
  });

  it("filters by date, user and action, and ignores anything invalid", () => {
    const q = auditQuery({ from: "2026-11-01", to: "2026-11-02", user: "u1", action: "SIGN_IN_FAILED", page: "3" }, now);
    expect(q.where).toMatchObject({ userId: "u1", action: "SIGN_IN_FAILED" });
    expect(q.where.at.gte.toISOString()).toBe("2026-10-31T22:00:00.000Z");
    expect(q.where.at.lt.toISOString()).toBe("2026-11-02T22:00:00.000Z");
    expect(q.page).toBe(3);
    const bad = auditQuery({ from: "yesterday", action: "DROP TABLE", page: "-4" }, now);
    expect(bad.from).toBe("2026-11-20");
    expect(bad.where).not.toHaveProperty("action");
    expect(bad.page).toBe(1);
  });
});
