import "server-only";
import { db } from "./db";
import type { Sheet } from "./excel";
import type { Col, Row } from "./reports";
import { itemKey } from "./work-items";

function flatten(records: Record<string, unknown>[]): { columns: Col[]; rows: Row[] } {
  const keys: string[] = [];
  for (const r of records) for (const k of Object.keys(r)) if (!keys.includes(k)) keys.push(k);
  const rows = records.map((r) => {
    const out: Row = {};
    for (const k of keys) {
      const v = r[k];
      out[k] = v == null ? null : v instanceof Date ? v.toISOString() : typeof v === "object" ? JSON.stringify(v) : typeof v === "boolean" ? (v ? "Yes" : "No") : (v as string | number);
    }
    return out;
  });
  return { columns: keys.map((k) => ({ key: k, label: k, numeric: records.some((r) => typeof r[k] === "number") })), rows };
}

/** Every table in the database, one sheet each. */
export async function buildBackupSheets(): Promise<Sheet[]> {
  const [settings, holidays, squads, lobs, members, memberships, leaves, items, history, sprints, shares, commitments, releases, changes, baselines, standups, lobAllocations] = await Promise.all([
    db.setting.findMany(),
    db.holiday.findMany({ orderBy: { date: "asc" } }),
    db.squad.findMany({ orderBy: { name: "asc" } }),
    db.lineOfBusiness.findMany({ orderBy: { name: "asc" } }),
    db.member.findMany({ orderBy: { name: "asc" } }),
    db.squadMembership.findMany(),
    db.leave.findMany({ orderBy: { startDate: "asc" } }),
    db.workItem.findMany({ orderBy: [{ lobId: "asc" }, { number: "asc" }] }),
    db.workItemHistory.findMany({ orderBy: { changedAt: "asc" } }),
    db.sprint.findMany({ orderBy: { startDate: "asc" } }),
    db.sprintMemberShare.findMany(),
    db.sprintCommitment.findMany(),
    db.release.findMany({ orderBy: { targetDate: "asc" } }),
    db.releaseDateChange.findMany({ orderBy: { changedAt: "asc" } }),
    db.taskBaseline.findMany(),
    db.standupEntry.findMany({ orderBy: { date: "asc" } }),
    db.memberLobAllocation.findMany(),
  ]);
  const [plans, pauses, users, roles, rolePermissions, audit] = await Promise.all([
    db.sprintMemberPlan.findMany(),
    db.sprintPause.findMany({ orderBy: { startDate: "asc" } }),
    // Never the password hash.
    db.user.findMany({ orderBy: { username: "asc" }, omit: { passwordHash: true } }),
    db.role.findMany({ orderBy: { name: "asc" } }),
    db.rolePermission.findMany(),
    db.auditLog.findMany({ orderBy: { at: "asc" } }),
  ]);
  const lobKey = new Map(lobs.map((l) => [l.id, l.key]));
  const itemsWithKey = items.map(({ ...i }) => ({ key: itemKey(lobKey.get(i.lobId) ?? "?", i.number), ...i }));
  const tables: [string, Record<string, unknown>[]][] = [
    ["Settings", settings], ["Holidays", holidays], ["Squads", squads], ["LinesOfBusiness", lobs], ["Members", members],
    ["SquadMemberships", memberships], ["MemberLobAllocations", lobAllocations], ["Leave", leaves], ["WorkItems", itemsWithKey], ["WorkItemHistory", history],
    ["Sprints", sprints], ["SprintShares", shares], ["SprintCommitments", commitments], ["Releases", releases],
    ["ReleaseDateChanges", changes], ["TaskBaselines", baselines], ["Standups", standups],
    ["SprintMemberPlans", plans], ["SprintPauses", pauses], ["Users", users], ["Roles", roles], ["RolePermissions", rolePermissions],
    ["AuditLog", audit],
  ];
  return tables.map(([title, records]) => ({ title, ...flatten(records) }));
}
