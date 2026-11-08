// Work item rules shared by pages and actions. No database access, so it is easy to test.
import type { Priority, WorkItemStatus, WorkItemType } from "@/lib/enums";

export const TYPES: WorkItemType[] = ["EPIC", "FEATURE", "STORY", "BUG", "TASK"];

export const TYPE_LABEL: Record<WorkItemType, string> = {
  EPIC: "Epic",
  FEATURE: "Feature",
  STORY: "User Story",
  BUG: "Bug",
  TASK: "Task",
};

export const STATUS_LABEL: Record<WorkItemStatus, string> = {
  NEW: "New",
  APPROVED: "Approved",
  COMMITTED: "Committed",
  IN_PROGRESS: "In Progress",
  DONE: "Done",
};

export const PRIORITIES: Priority[] = ["HIGH", "MEDIUM", "LOW"];
export const PRIORITY_LABEL: Record<Priority, string> = { HIGH: "High", MEDIUM: "Medium", LOW: "Low" };

/** Allowed statuses per type. Epics and features have no workflow; progress comes from children. */
export function statusesFor(type: WorkItemType): WorkItemStatus[] {
  if (type === "STORY" || type === "BUG") return ["NEW", "APPROVED", "COMMITTED", "DONE"];
  if (type === "TASK") return ["NEW", "IN_PROGRESS", "DONE"];
  return [];
}

export function hasWorkflow(type: WorkItemType): boolean {
  return statusesFor(type).length > 0;
}

/** Which parent types an item may have. Empty list = no parent allowed. */
export const PARENT_TYPES: Record<WorkItemType, WorkItemType[]> = {
  EPIC: [],
  FEATURE: ["EPIC"],
  STORY: ["FEATURE"],
  BUG: ["FEATURE"],
  TASK: ["STORY", "BUG"],
};

/** Whether a parent is required (true) or optional (false). */
export const PARENT_REQUIRED: Record<WorkItemType, boolean> = {
  EPIC: false,
  FEATURE: true,
  STORY: false,
  BUG: false,
  TASK: true,
};

/** Which child types can be added under an item. */
export function childTypesOf(type: WorkItemType): WorkItemType[] {
  return TYPES.filter((t) => PARENT_TYPES[t].includes(type));
}

/** Returns an error message, or null when the parent is valid for the type. */
export function validateParent(type: WorkItemType, parentType: WorkItemType | null): string | null {
  if (!parentType) {
    return PARENT_REQUIRED[type]
      ? `A ${TYPE_LABEL[type]} must be placed under a ${PARENT_TYPES[type].map((t) => TYPE_LABEL[t]).join(" or ")}.`
      : null;
  }
  if (!PARENT_TYPES[type].includes(parentType)) {
    return `A ${TYPE_LABEL[type]} cannot be placed under a ${TYPE_LABEL[parentType]}.`;
  }
  return null;
}

export function itemKey(lobKey: string, number: number): string {
  return `${lobKey}-${number}`;
}

/** LOB keys: 2-6 uppercase letters/digits, starting with a letter. */
export function normalizeLobKey(value: string): string {
  return value.trim().toUpperCase();
}
export const LOB_KEY_PATTERN = /^[A-Z][A-Z0-9]{1,5}$/;

// ---------- roll-ups ----------

export type RollupNode = {
  type: WorkItemType;
  status: WorkItemStatus;
  estimateHours: number | null;
  children: RollupNode[];
};

export type Rollup = {
  /** Sum of task estimates below (or own estimate for a task) */
  totalHours: number;
  /** Sum of estimates of Done tasks */
  doneHours: number;
  /** Tasks below without an estimate */
  unestimatedTasks: number;
  /** Stories + bugs below (or self) and how many are Done */
  stories: number;
  storiesDone: number;
};

export function rollup(node: RollupNode): Rollup {
  if (node.type === "TASK") {
    const h = node.estimateHours ?? 0;
    return {
      totalHours: h,
      doneHours: node.status === "DONE" ? h : 0,
      unestimatedTasks: node.estimateHours == null ? 1 : 0,
      stories: 0,
      storiesDone: 0,
    };
  }
  const sum = node.children.map(rollup).reduce<Rollup>(
    (a, b) => ({
      totalHours: a.totalHours + b.totalHours,
      doneHours: a.doneHours + b.doneHours,
      unestimatedTasks: a.unestimatedTasks + b.unestimatedTasks,
      stories: a.stories + b.stories,
      storiesDone: a.storiesDone + b.storiesDone,
    }),
    { totalHours: 0, doneHours: 0, unestimatedTasks: 0, stories: 0, storiesDone: 0 },
  );
  if (node.type === "STORY" || node.type === "BUG") {
    sum.stories += 1;
    if (node.status === "DONE") sum.storiesDone += 1;
  }
  return sum;
}

/** Progress % for display: by hours when there are estimates, otherwise by finished stories/bugs. */
export function progressPercent(r: Rollup): number | null {
  if (r.totalHours > 0) return Math.round((r.doneHours / r.totalHours) * 100);
  if (r.stories > 0) return Math.round((r.storiesDone / r.stories) * 100);
  return null;
}

/** Rank that places an item after its last sibling. */
export function nextRank(siblingRanks: number[]): number {
  return siblingRanks.length ? Math.max(...siblingRanks) + 1 : 1;
}
