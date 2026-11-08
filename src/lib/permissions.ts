// Every permission in the system, grouped by page or feature. Pure data and helpers (no database), so it is easy to test.
// A role is a name plus a list of these keys. The built-in Administrator role has all of them.

export type PermissionDef = { key: string; label: string; hint?: string };
export type PermissionGroup = { key: string; label: string; path?: string; permissions: PermissionDef[] };

export const PERMISSION_GROUPS: PermissionGroup[] = [
  { key: "dashboard", label: "Dashboard", path: "/", permissions: [{ key: "dashboard.view", label: "View" }] },
  {
    key: "squads", label: "Squads", path: "/squads",
    permissions: [{ key: "squads.view", label: "View" }, { key: "squads.manage", label: "Add, edit and delete" }],
  },
  {
    key: "lobs", label: "Lines of Business", path: "/lobs",
    permissions: [{ key: "lobs.view", label: "View" }, { key: "lobs.manage", label: "Add, edit and delete" }],
  },
  {
    key: "members", label: "Members", path: "/members",
    permissions: [
      { key: "members.view", label: "View" },
      { key: "members.manage", label: "Add, edit and delete", hint: "Also squad hours, leave and shared hours" },
    ],
  },
  {
    key: "backlog", label: "Backlog and work items", path: "/backlog",
    permissions: [
      { key: "backlog.view", label: "View" },
      { key: "backlog.edit", label: "Add and edit items", hint: "Title, status, estimate, assignee, order" },
      { key: "backlog.delete", label: "Delete items" },
    ],
  },
  {
    key: "sprints", label: "Sprints", path: "/sprints",
    permissions: [
      { key: "sprints.view", label: "View" },
      { key: "sprints.manage", label: "Plan sprints", hint: "Create, edit, delete, add and remove items, capacity shares" },
      { key: "sprints.run", label: "Start, pause, resume and close" },
      { key: "sprints.import", label: "Import sprint planning sheets" },
    ],
  },
  {
    key: "board", label: "Sprint Board", path: "/board",
    permissions: [{ key: "board.view", label: "View" }, { key: "board.move", label: "Move cards (change status)" }],
  },
  {
    key: "releases", label: "Releases", path: "/releases",
    permissions: [{ key: "releases.view", label: "View" }, { key: "releases.manage", label: "Add, edit, deploy and delete" }],
  },
  {
    key: "timeline", label: "Timeline", path: "/timeline",
    permissions: [
      { key: "timeline.view", label: "View" },
      { key: "timeline.act", label: "Act on slips", hint: "Reassign, re-estimate, move to next sprint, accept dates" },
    ],
  },
  {
    key: "standup", label: "Daily Standup", path: "/standup",
    permissions: [{ key: "standup.view", label: "View" }, { key: "standup.edit", label: "Write statuses" }],
  },
  {
    key: "reports", label: "Reports", path: "/reports",
    permissions: [{ key: "reports.view", label: "View" }, { key: "reports.export", label: "Export to Excel" }],
  },
  {
    key: "settings", label: "Settings", path: "/settings",
    permissions: [{ key: "settings.view", label: "View" }, { key: "settings.manage", label: "Change settings and holidays" }],
  },
  {
    key: "data", label: "Import & Backup", path: "/data",
    permissions: [
      { key: "data.import", label: "Import work items from Excel" },
      { key: "data.backup", label: "Download the full backup", hint: "Contains every table" },
    ],
  },
  {
    key: "users", label: "Users", path: "/users",
    permissions: [{ key: "users.manage", label: "Manage users", hint: "Add users, change roles, reset passwords" }],
  },
  {
    key: "roles", label: "Roles", path: "/roles",
    permissions: [{ key: "roles.manage", label: "Manage roles and permissions" }],
  },
];

export const ALL_PERMISSIONS: string[] = PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => p.key));
const KNOWN = new Set(ALL_PERMISSIONS);

/** The starting "Viewer" role: every page, nothing changed. Downloads of reports and the backup included, as before. */
export const VIEWER_PERMISSIONS: string[] = [
  ...ALL_PERMISSIONS.filter((k) => k.endsWith(".view")),
  "reports.export",
  "data.backup",
];

/**
 * Cleans a list coming from a form: unknown keys are dropped, and any permission in a group brings that group's
 * "View" with it (you cannot edit what you cannot see).
 */
export function normalizePermissions(keys: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const k of keys) {
    if (!KNOWN.has(k)) continue;
    out.add(k);
    const view = `${k.split(".")[0]}.view`;
    if (KNOWN.has(view)) out.add(view);
  }
  return ALL_PERMISSIONS.filter((k) => out.has(k));
}

/** The pages in the menu, in menu order, with the permission that opens each. */
export const PAGE_ACCESS: { path: string; anyOf: string[] }[] = [
  { path: "/", anyOf: ["dashboard.view"] },
  { path: "/squads", anyOf: ["squads.view"] },
  { path: "/lobs", anyOf: ["lobs.view"] },
  { path: "/members", anyOf: ["members.view"] },
  { path: "/backlog", anyOf: ["backlog.view"] },
  { path: "/sprints", anyOf: ["sprints.view"] },
  { path: "/board", anyOf: ["board.view"] },
  { path: "/releases", anyOf: ["releases.view"] },
  { path: "/timeline", anyOf: ["timeline.view"] },
  { path: "/standup", anyOf: ["standup.view"] },
  { path: "/reports", anyOf: ["reports.view"] },
  { path: "/settings", anyOf: ["settings.view"] },
  { path: "/data", anyOf: ["data.import", "data.backup"] },
  { path: "/users", anyOf: ["users.manage"] },
  { path: "/roles", anyOf: ["roles.manage"] },
];

export function hasAny(granted: ReadonlySet<string>, anyOf: string[]): boolean {
  return anyOf.some((p) => granted.has(p));
}

/** Where to send someone after sign-in, or when they open a page they may not see. */
export function firstAllowedPath(granted: ReadonlySet<string>): string {
  return PAGE_ACCESS.find((p) => hasAny(granted, p.anyOf))?.path ?? "/profile";
}
