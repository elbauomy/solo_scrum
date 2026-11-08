import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, PAGE_ACCESS, PERMISSION_GROUPS, VIEWER_PERMISSIONS, firstAllowedPath, hasAny, normalizePermissions } from "./permissions";

describe("permissions", () => {
  it("every key is unique and belongs to its group", () => {
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length);
    for (const g of PERMISSION_GROUPS) for (const p of g.permissions) expect(p.key.startsWith(`${g.key}.`)).toBe(true);
  });

  it("any permission in a group brings its View; unknown keys are dropped", () => {
    expect(normalizePermissions(["sprints.run", "nonsense.x", "board.move"])).toEqual(["sprints.view", "sprints.run", "board.view", "board.move"]);
    expect(normalizePermissions(["users.manage"])).toEqual(["users.manage"]);
    expect(normalizePermissions(["data.backup"])).toEqual(["data.backup"]);
  });

  it("the Viewer role sees every page and changes nothing", () => {
    for (const k of VIEWER_PERMISSIONS) expect(k.endsWith(".view") || k === "reports.export" || k === "data.backup").toBe(true);
    expect(VIEWER_PERMISSIONS).not.toContain("users.manage");
    expect(VIEWER_PERMISSIONS).not.toContain("backlog.edit");
  });

  it("every menu page is reachable by some permission", () => {
    for (const p of PAGE_ACCESS) for (const k of p.anyOf) expect(ALL_PERMISSIONS).toContain(k);
  });

  it("sends people to the first page they may open", () => {
    expect(firstAllowedPath(new Set(ALL_PERMISSIONS))).toBe("/");
    expect(firstAllowedPath(new Set(["board.view", "standup.view"]))).toBe("/board");
    expect(firstAllowedPath(new Set())).toBe("/profile");
    expect(hasAny(new Set(["a"]), ["b", "a"])).toBe(true);
  });
});
