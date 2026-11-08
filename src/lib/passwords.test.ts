import { describe, expect, it } from "vitest";
import { generateTemporaryPassword, hashPassword, passwordProblem, verifyPassword } from "./passwords";

describe("passwords", () => {
  it("hashes with a salt and verifies", async () => {
    const a = await hashPassword("correct horse battery");
    const b = await hashPassword("correct horse battery");
    expect(a).not.toBe(b);
    expect(a.startsWith("scrypt$16384$8$1$")).toBe(true);
    expect(await verifyPassword("correct horse battery", a)).toBe(true);
    expect(await verifyPassword("correct horse batterY", a)).toBe(false);
  });

  it("never accepts a missing or broken hash", async () => {
    expect(await verifyPassword("anything", null)).toBe(false);
    expect(await verifyPassword("anything", undefined)).toBe(false);
    expect(await verifyPassword("anything", "plain-text")).toBe(false);
    expect(await verifyPassword("", "scrypt$1$1$1$x$y")).toBe(false);
  });

  it("checks the password rules", () => {
    expect(passwordProblem("short", "khaled")).toMatch(/at least 10/);
    expect(passwordProblem("Khaled Elbauomy", "khaled elbauomy")).toMatch(/user name/);
    expect(passwordProblem("aaaaaaaaaaaa", "x")).toMatch(/repeat/);
    expect(passwordProblem("a".repeat(201), "x")).toMatch(/at most/);
    expect(passwordProblem("Sprint-62-ready!", "khaled elbauomy")).toBeNull();
  });

  it("makes temporary passwords that pass the rules", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const p = generateTemporaryPassword();
      expect(p).toMatch(/^[a-zA-Z2-9]{14}$/);
      expect(p).not.toMatch(/[01lIoO]/);
      expect(passwordProblem(p, "someone")).toBeNull();
      seen.add(p);
    }
    expect(seen.size).toBe(50);
  });
});
