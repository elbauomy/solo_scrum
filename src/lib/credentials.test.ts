import { describe, expect, it } from "vitest";
import { accountsFromEnv, displayName, normalizeName } from "./credentials";

const accounts = accountsFromEnv({ APP_PASSWORD: "owner-pass", VIEWER_PASSWORD: "viewer-pass" });

describe("accounts", () => {
  it("has the owner and a view-only user with the agreed user names", () => {
    expect(accounts.map((a) => [a.username, a.role])).toEqual([["khaled elbauomy", "admin"], ["remoon milad", "viewer"]]);
  });
  it("user names can be changed from the environment", () => {
    expect(accountsFromEnv({ ADMIN_USERNAME: " Boss ", VIEWER_USERNAME: "guest" }).map((a) => a.username)).toEqual(["Boss", "guest"]);
  });
});

describe("names", () => {
  it("formats names", () => {
    expect(normalizeName("  A   B ")).toBe("a b");
    expect(displayName("khaled elbauomy")).toBe("Khaled Elbauomy");
  });
});
