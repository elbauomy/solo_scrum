import { describe, expect, it } from "vitest";
import { generateTemporaryPassword, hashPassword, verifyPassword } from "./passwords";
import { passwordProblem } from "./sign-in-security";

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

  it("makes temporary passwords that pass the rules", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const p = generateTemporaryPassword();
      expect(p).toMatch(/^[a-zA-Z2-9]{14}$/);
      expect(p).not.toMatch(/[01lIoO]/);
      expect(passwordProblem(p, 8)).toBeNull();
      expect(passwordProblem(generateTemporaryPassword(20), 20)).toBeNull();
      seen.add(p);
    }
    expect(seen.size).toBe(50);
  });
});
