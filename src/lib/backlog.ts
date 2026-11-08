import "server-only";
import type { Priority, WorkItemStatus, WorkItemType } from "@/lib/enums";
import { db } from "./db";
import { parseDate, addDays } from "./dates";
import { itemKey, progressPercent, rollup, type RollupNode } from "./work-items";

export type BacklogFilters = {
  squad?: string;
  lob?: string;
  type?: string;
  status?: string;
  assignee?: string; // member id or "none"
  priority?: string;
  blocked?: string; // "1"
  noEstimate?: string; // "1"
  q?: string;
  from?: string; // created from YYYY-MM-DD
  to?: string; // created to YYYY-MM-DD
};

/** Filters that hide some items (squad and LOB only narrow the scope). */
export function hasItemFilters(f: BacklogFilters): boolean {
  return Boolean(f.type || f.status || f.assignee || f.priority || f.blocked || f.noEstimate || f.q || f.from || f.to);
}

export type BacklogRow = {
  id: string;
  key: string;
  type: WorkItemType;
  title: string;
  status: WorkItemStatus;
  priority: Priority;
  assigneeName: string | null;
  estimateHours: number | null;
  totalHours: number;
  doneHours: number;
  progress: number | null;
  unestimatedTasks: number;
  blocked: boolean;
  blockedReason: string;
  depth: number;
  parentId: string | null;
  childCount: number;
  /** false = shown only because a child matches the filters */
  matched: boolean;
};

export type BacklogGroup = { lob: { id: string; name: string; key: string; squadName: string }; rows: BacklogRow[]; totalItems: number };

type Item = Awaited<ReturnType<typeof loadItems>>[number];
type Node = Item & { kids: Node[] };

function loadItems(lobIds: string[]) {
  return db.workItem.findMany({
    where: { lobId: { in: lobIds } },
    orderBy: [{ rank: "asc" }, { number: "asc" }],
    include: { assignee: { select: { name: true } } },
  });
}

function safeDate(v?: string): Date | null {
  if (!v) return null;
  try {
    return parseDate(v);
  } catch {
    return null;
  }
}

export async function loadBacklog(f: BacklogFilters): Promise<BacklogGroup[]> {
  const lobs = await db.lineOfBusiness.findMany({
    where: { ...(f.squad ? { squadId: f.squad } : {}), ...(f.lob ? { id: f.lob } : {}) },
    orderBy: { name: "asc" },
    include: { squad: { select: { name: true } } },
  });
  if (lobs.length === 0) return [];
  const items = await loadItems(lobs.map((l) => l.id));

  const from = safeDate(f.from);
  const toExclusive = safeDate(f.to) ? addDays(safeDate(f.to)!, 1) : null;
  const q = f.q?.trim().toLowerCase();
  const lobKey = new Map(lobs.map((l) => [l.id, l.key]));

  const matches = (i: Item): boolean => {
    if (f.type && i.type !== f.type) return false;
    if (f.status && i.status !== f.status) return false;
    if (f.priority && i.priority !== f.priority) return false;
    if (f.assignee === "none" && (i.type !== "TASK" || i.assigneeId)) return false;
    if (f.assignee && f.assignee !== "none" && i.assigneeId !== f.assignee) return false;
    if (f.blocked && !i.blocked) return false;
    if (f.noEstimate && (i.type !== "TASK" || i.estimateHours != null)) return false;
    if (from && i.createdAt < from) return false;
    if (toExclusive && i.createdAt >= toExclusive) return false;
    if (q) {
      const key = itemKey(lobKey.get(i.lobId)!, i.number).toLowerCase();
      if (!i.title.toLowerCase().includes(q) && !key.startsWith(q)) return false;
    }
    return true;
  };

  // Build the tree.
  const nodes = new Map<string, Node>(items.map((i) => [i.id, { ...i, kids: [] }]));
  const roots = new Map<string, Node[]>(lobs.map((l) => [l.id, []]));
  for (const n of nodes.values()) {
    const parent = n.parentId ? nodes.get(n.parentId) : undefined;
    if (parent) parent.kids.push(n);
    else roots.get(n.lobId)!.push(n);
  }

  const toRollup = (n: Node): RollupNode => ({ type: n.type, status: n.status, estimateHours: n.estimateHours, children: n.kids.map(toRollup) });
  const filtering = hasItemFilters(f);

  return lobs.map((lob) => {
    const rows: BacklogRow[] = [];
    // Returns true when this node or a descendant matches.
    const visit = (n: Node, depth: number, out: BacklogRow[]): boolean => {
      const childRows: BacklogRow[] = [];
      let childMatched = false;
      for (const k of n.kids) childMatched = visit(k, depth + 1, childRows) || childMatched;
      const self = !filtering || matches(n);
      if (!self && !childMatched) return false;
      const r = rollup(toRollup(n));
      out.push(
        {
          id: n.id,
          key: itemKey(lob.key, n.number),
          type: n.type,
          title: n.title,
          status: n.status,
          priority: n.priority,
          assigneeName: n.assignee?.name ?? null,
          estimateHours: n.estimateHours,
          totalHours: r.totalHours,
          doneHours: r.doneHours,
          progress: progressPercent(r),
          unestimatedTasks: r.unestimatedTasks,
          blocked: n.blocked,
          blockedReason: n.blockedReason,
          depth,
          parentId: n.parentId,
          childCount: n.kids.length,
          matched: self,
        },
        ...childRows,
      );
      return true;
    };
    for (const root of roots.get(lob.id)!) visit(root, 0, rows);
    return {
      lob: { id: lob.id, name: lob.name, key: lob.key, squadName: lob.squad.name },
      rows,
      totalItems: items.filter((i) => i.lobId === lob.id).length,
    };
  });
}
