// Two-way sync with Azure DevOps. Pure logic: no database, no network, so every rule is easy to test.
//
// Who owns what:
//   Azure DevOps owns   title, description, acceptance criteria, type and place in the hierarchy.
//   Solo Scrum owns     hours, rank, blocked flag, and the priority once an item exists.
//   Both sides          status, assignee (tasks) and sprint (stories and bugs). The side that changed wins;
//                       if both changed since the last sync, the most recent change wins.
// Nothing is ever deleted on either side, and items are created in Solo Scrum only (never in Azure DevOps).
import type { Priority, WorkItemStatus, WorkItemType } from "@prisma/client";
import { ADO_TYPE_TO_LOCAL, type PatchOp, type RawIteration, type RawWorkItem } from "./ado-client";
import { PARENT_TYPES, PARENT_REQUIRED, TYPE_LABEL, validateParent } from "./work-items";

// ---------- reading Azure DevOps ----------

export type AdoItem = {
  id: number;
  rev: number;
  type: WorkItemType;
  state: string;
  /** Our status, or null for epics and features (they have no workflow here) */
  status: WorkItemStatus | null;
  removed: boolean;
  /** Azure DevOps state is Done / Closed */
  finished: boolean;
  title: string;
  description: string;
  acceptanceCriteria: string;
  iterationPath: string;
  assignee: string | null;
  priority: Priority;
  parentId: number | null;
  changedAt: Date;
  createdAt: Date;
  doneAt: Date | null;
  backlogRank: number | null;
  /** Hours planned for a task (original estimate, else remaining work) */
  hours: number | null;
};

/** Azure DevOps stores descriptions as HTML; we keep plain text. */
export function htmlToText(html: string): string {
  if (!html) return "";
  const text = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|h[1-6]|tr)\s*>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "• ")
    .replace(/<\/\s*li\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&");
  return text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function normalizeName(name: string | null | undefined): string {
  return (name ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/** Azure DevOps state -> our status. */
export function statusFromState(type: WorkItemType, state: string): WorkItemStatus | null {
  const s = state.trim().toLowerCase();
  if (type === "STORY" || type === "BUG") {
    if (s === "new") return "NEW";
    if (s === "approved") return "APPROVED";
    if (s === "committed") return "COMMITTED";
    if (s === "done") return "DONE";
    return null;
  }
  if (type === "TASK") {
    if (s === "to do" || s === "new") return "NEW";
    if (s === "in progress") return "IN_PROGRESS";
    if (s === "done") return "DONE";
    return null;
  }
  return null;
}

/** Our status -> Azure DevOps state (Scrum process). */
export function stateFromStatus(type: WorkItemType, status: WorkItemStatus): string | null {
  if (type === "STORY" || type === "BUG") {
    return { NEW: "New", APPROVED: "Approved", COMMITTED: "Committed", DONE: "Done", IN_PROGRESS: null }[status];
  }
  if (type === "TASK") {
    return { NEW: "To Do", IN_PROGRESS: "In Progress", DONE: "Done", APPROVED: null, COMMITTED: null }[status];
  }
  return null;
}

function priorityFromAdo(value: unknown): Priority {
  const n = Number(value);
  if (n === 1) return "HIGH";
  if (n === 3 || n === 4) return "LOW";
  return "MEDIUM";
}

const hoursOf = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : null);
const str = (v: unknown) => (typeof v === "string" ? v : "");
const date = (v: unknown): Date | null => {
  if (typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Converts a raw API work item. Returns null for types we do not bring in (test cases, impediments, ...). */
export function toAdoItem(raw: RawWorkItem): AdoItem | null {
  const f = raw.fields;
  const type = ADO_TYPE_TO_LOCAL[str(f["System.WorkItemType"])];
  if (!type) return null;
  const state = str(f["System.State"]);
  const assigned = f["System.AssignedTo"];
  const assignee =
    assigned && typeof assigned === "object" ? str((assigned as { displayName?: unknown }).displayName) || null : typeof assigned === "string" && assigned ? assigned : null;
  const parent = Number(f["System.Parent"]);
  const rank = Number(f["Microsoft.VSTS.Common.BacklogPriority"]);
  const lower = state.toLowerCase();
  const finished = lower === "done" || lower === "closed";
  return {
    id: raw.id,
    rev: raw.rev,
    type,
    state,
    status: statusFromState(type, state),
    removed: lower === "removed",
    finished,
    title: str(f["System.Title"]).trim() || `(untitled ${raw.id})`,
    description: htmlToText(str(f["System.Description"])),
    acceptanceCriteria: htmlToText(str(f["Microsoft.VSTS.Common.AcceptanceCriteria"])),
    iterationPath: str(f["System.IterationPath"]),
    assignee,
    priority: priorityFromAdo(f["Microsoft.VSTS.Common.Priority"]),
    parentId: Number.isInteger(parent) && parent > 0 ? parent : null,
    changedAt: date(f["System.ChangedDate"]) ?? new Date(0),
    createdAt: date(f["System.CreatedDate"]) ?? new Date(),
    doneAt: date(f["Microsoft.VSTS.Common.ClosedDate"]) ?? date(f["Microsoft.VSTS.Common.StateChangeDate"]),
    backlogRank: Number.isFinite(rank) && f["Microsoft.VSTS.Common.BacklogPriority"] != null ? rank : null,
    hours: hoursOf(f["Microsoft.VSTS.Scheduling.OriginalEstimate"]) ?? hoursOf(f["Microsoft.VSTS.Scheduling.RemainingWork"]),
  };
}

// ---------- what we remember from the last sync ----------

/** What both sides agreed on at the last sync. Used to tell which side changed. */
export type ItemSnapshot = {
  rev: number;
  status: WorkItemStatus | null;
  /** Normalized member name */
  assignee: string | null;
  /** Iteration path */
  sprint: string | null;
  /** Remaining hours last sent to Azure DevOps */
  hours: number | null;
};

export type LocalItem = {
  id: string;
  adoId: number | null;
  type: WorkItemType;
  status: WorkItemStatus;
  title: string;
  description: string;
  acceptanceCriteria: string;
  parentId: string | null;
  assigneeId: string | null;
  sprintId: string | null;
  estimateHours: number | null;
  updatedAt: Date;
  snapshot: ItemSnapshot | null;
};

export type LocalSprint = { id: string; name: string; adoPath: string | null; state: "PLANNED" | "ACTIVE" | "PAUSED" | "CLOSED" };
export type LocalMember = { id: string; name: string };

// ---------- the plan ----------

export type PlannedCreate = {
  id: string;
  adoId: number;
  type: WorkItemType;
  title: string;
  description: string;
  acceptanceCriteria: string;
  status: WorkItemStatus;
  priority: Priority;
  parentId: string | null;
  assigneeId: string | null;
  sprintId: string | null;
  rank: number;
  estimateHours: number | null;
  createdAt: Date;
  doneAt: Date | null;
  snapshot: ItemSnapshot;
};

export type HistoryChange = { field: string; oldValue: string | null; newValue: string | null };

export type PlannedLocalUpdate = {
  id: string;
  adoId: number;
  label: string;
  data: {
    title?: string;
    description?: string;
    acceptanceCriteria?: string;
    parentId?: string | null;
    status?: WorkItemStatus;
    doneAt?: Date | null;
    assigneeId?: string | null;
    sprintId?: string | null;
  };
  history: HistoryChange[];
  snapshot: ItemSnapshot;
};

export type SyncField = "status" | "assignee" | "sprint" | "hours";

export type PlannedAdoUpdate = {
  adoId: number;
  localId: string;
  label: string;
  rev: number;
  /** One entry per field, so a refused field does not block the others */
  fields: { key: SyncField; ops: PatchOp[]; snapshot: Partial<ItemSnapshot> }[];
};

export type PlannedSprint = { id: string; name: string; adoPath: string; startDate: string; endDate: string };

export type SyncNote = { kind: string; message: string };

export type SyncPlan = {
  sprintCreates: PlannedSprint[];
  sprintLinks: { id: string; adoPath: string }[];
  creates: PlannedCreate[];
  localUpdates: PlannedLocalUpdate[];
  adoUpdates: PlannedAdoUpdate[];
  /** Linked items whose remembered state only needs refreshing (nothing else changed) */
  snapshotRefresh: { id: string; snapshot: ItemSnapshot }[];
  notes: SyncNote[];
  conflicts: string[];
  stats: { adoItems: number; linked: number; localOnly: number };
};

export type SyncInput = {
  project: string;
  today: Date;
  ado: AdoItem[];
  iterations: RawIteration[];
  local: LocalItem[];
  sprints: LocalSprint[];
  members: LocalMember[];
  newId: () => string;
  /** Do not bring in finished items last changed before this date (already linked items are always kept in step) */
  skipFinishedBefore: Date | null;
};


/** Most notes of one kind that are listed by name. */
export const NOTE_EXAMPLES = 5;

export function planSync(input: SyncInput): SyncPlan {
  const { project, ado, local, sprints, members } = input;
  const notes: SyncNote[] = [];
  const note = (kind: string, message: string) => notes.push({ kind, message });
  const conflicts: string[] = [];

  const adoById = new Map(ado.map((a) => [a.id, a]));
  const localByAdo = new Map(local.filter((l) => l.adoId != null).map((l) => [l.adoId as number, l]));
  const memberByName = new Map(members.map((m) => [normalizeName(m.name), m]));
  const memberById = new Map(members.map((m) => [m.id, m]));
  const sprintById = new Map(sprints.map((s) => [s.id, s]));

  // ----- sprints: link by path or name, create the ones that have not ended yet -----
  const pathToSprint = new Map<string, string>();
  for (const s of sprints) if (s.adoPath) pathToSprint.set(s.adoPath.toLowerCase(), s.id);
  const sprintLinks: SyncPlan["sprintLinks"] = [];
  const sprintCreates: PlannedSprint[] = [];
  const unlinkedByName = new Map<string, LocalSprint>();
  for (const s of sprints) if (!s.adoPath) unlinkedByName.set(s.name.trim().toLowerCase(), s);
  const todayKey = input.today.toISOString().slice(0, 10);
  for (const it of input.iterations) {
    if (pathToSprint.has(it.path.toLowerCase())) continue;
    const byName = unlinkedByName.get(it.name.trim().toLowerCase());
    if (byName) {
      sprintLinks.push({ id: byName.id, adoPath: it.path });
      pathToSprint.set(it.path.toLowerCase(), byName.id);
      unlinkedByName.delete(it.name.trim().toLowerCase());
      continue;
    }
    if (it.startDate && it.finishDate && it.finishDate.slice(0, 10) >= todayKey) {
      const id = input.newId();
      sprintCreates.push({ id, name: it.name, adoPath: it.path, startDate: it.startDate.slice(0, 10), endDate: it.finishDate.slice(0, 10) });
      pathToSprint.set(it.path.toLowerCase(), id);
    }
  }
  const sprintPath = new Map<string, string>(); // sprint id -> path (including newly linked/created)
  for (const s of sprints) if (s.adoPath) sprintPath.set(s.id, s.adoPath);
  for (const l of sprintLinks) sprintPath.set(l.id, l.adoPath);
  for (const c of sprintCreates) sprintPath.set(c.id, c.adoPath);
  const rootPath = project;
  /** Sprint id for an iteration path: null = no sprint (backlog), undefined = a sprint we do not have. */
  const sprintForPath = (path: string): string | null | undefined => {
    if (!path || path.toLowerCase() === rootPath.toLowerCase()) return null;
    return pathToSprint.get(path.toLowerCase());
  };
  const pathOfSprint = (id: string | null): string | undefined => (id ? sprintPath.get(id) : rootPath);

  // ----- new items -----
  const childrenOf = new Map<number, number[]>();
  for (const a of ado) if (a.parentId != null) childrenOf.set(a.parentId, [...(childrenOf.get(a.parentId) ?? []), a.id]);
  const keepMemo = new Map<number, boolean>();
  const shouldKeep = (a: AdoItem, trail = new Set<number>()): boolean => {
    const memo = keepMemo.get(a.id);
    if (memo != null) return memo;
    if (trail.has(a.id)) return true;
    trail.add(a.id);
    const old = input.skipFinishedBefore != null && a.finished && a.changedAt < input.skipFinishedBefore;
    let keep = !old;
    if (!keep) {
      keep = (childrenOf.get(a.id) ?? []).some((c) => {
        const child = adoById.get(c);
        return child != null && !child.removed && shouldKeep(child, trail);
      });
    }
    keepMemo.set(a.id, keep);
    return keep;
  };

  const newIdFor = new Map<number, string>(); // adoId -> new local id
  const newType = new Map<number, WorkItemType>();
  let movedUp = 0;
  const lostSprints = new Map<string, number>();
  /**
   * Where an item belongs here. Azure DevOps allows more than we do (a bug under a user story, a story under an epic),
   * so when its direct parent is not allowed we go up to the nearest parent that is.
   */
  const resolveParent = (a: AdoItem): { id: string; type: WorkItemType; direct: boolean } | null => {
    const seen = new Set<number>();
    let cur = a.parentId;
    while (cur != null && !seen.has(cur)) {
      seen.add(cur);
      const known = localByAdo.get(cur);
      const id = known?.id ?? newIdFor.get(cur);
      const type = known?.type ?? newType.get(cur);
      if (id && type && !validateParent(a.type, type)) return { id, type, direct: cur === a.parentId };
      cur = adoById.get(cur)?.parentId ?? null;
    }
    return null;
  };
  const createdSprint = new Map<string, string | null>();
  const creates: PlannedCreate[] = [];
  const unknownAssignees = new Set<string>();
  const TYPE_ORDER: WorkItemType[] = ["EPIC", "FEATURE", "STORY", "BUG", "TASK"];
  const candidates = ado
    .filter((a) => !localByAdo.has(a.id) && !a.removed)
    .sort((x, y) => TYPE_ORDER.indexOf(x.type) - TYPE_ORDER.indexOf(y.type) || (x.backlogRank ?? Infinity) - (y.backlogRank ?? Infinity) || x.id - y.id);
  const skippedOld: number[] = [];
  const rankCounters = new Map<string, number>();
  for (const a of candidates) {
    if (!shouldKeep(a)) {
      skippedOld.push(a.id);
      continue;
    }
    const placed = resolveParent(a);
    const parentLocal = placed ? placed.id : null;
    if (placed && !placed.direct) movedUp++;
    if (!parentLocal && PARENT_REQUIRED[a.type]) {
      note("skipped", `${TYPE_LABEL[a.type]} ${a.id} "${a.title}" was not brought in: it needs ${PARENT_TYPES[a.type].map((t) => `a${/^[AEIO]/i.test(TYPE_LABEL[t]) ? "n" : ""} ${TYPE_LABEL[t]}`).join(" or ")} above it.`);
      continue;
    }
    let assigneeId: string | null = null;
    if (a.type === "TASK" && a.assignee) {
      const m = memberByName.get(normalizeName(a.assignee));
      if (m) assigneeId = m.id;
      else unknownAssignees.add(a.assignee);
    }
    // Stories and bugs carry the sprint; a task keeps the sprint it was finished in, otherwise follows its story.
    let sprintId: string | null = null;
    if (a.type === "STORY" || a.type === "BUG") {
      const found = sprintForPath(a.iterationPath);
      sprintId = found ?? null;
      if (found === undefined) lostSprints.set(a.iterationPath, (lostSprints.get(a.iterationPath) ?? 0) + 1);
    } else if (a.type === "TASK") {
      const own = sprintForPath(a.iterationPath);
      if (own) sprintId = own;
      else if (parentLocal) sprintId = createdSprint.get(parentLocal) ?? local.find((l) => l.id === parentLocal)?.sprintId ?? null;
    }
    const status: WorkItemStatus = a.status ?? "NEW";
    const id = input.newId();
    newIdFor.set(a.id, id);
    newType.set(a.id, a.type);
    const rankKey = parentLocal ?? "root";
    const rank = (rankCounters.get(rankKey) ?? 0) + 1;
    rankCounters.set(rankKey, rank);
    creates.push({
      id,
      adoId: a.id,
      type: a.type,
      title: a.title.slice(0, 200),
      description: a.description,
      acceptanceCriteria: a.acceptanceCriteria,
      status,
      priority: a.priority,
      parentId: parentLocal,
      assigneeId,
      sprintId,
      rank,
      estimateHours: a.type === "TASK" ? a.hours : null,
      createdAt: a.createdAt,
      doneAt: status === "DONE" ? (a.doneAt ?? a.changedAt) : null,
      snapshot: {
        rev: a.rev,
        status: a.status,
        assignee: a.type === "TASK" ? (assigneeId ? normalizeName(a.assignee) : null) : null,
        // What this side looks like now, so an unknown sprint is not mistaken for a local change later.
        sprint: a.type === "STORY" || a.type === "BUG" ? (sprintId ? (pathOfSprint(sprintId) ?? rootPath) : a.iterationPath || rootPath) : null,
        hours: a.type === "TASK" && a.hours != null ? (status === "DONE" ? 0 : a.hours) : null,
      },
    });
    createdSprint.set(id, sprintId);
  }

  // ----- items that are already linked -----
  const localUpdates: PlannedLocalUpdate[] = [];
  const adoUpdates = new Map<number, PlannedAdoUpdate>();
  const snapshotRefresh: SyncPlan["snapshotRefresh"] = [];
  let linked = 0;

  const adoUpdateFor = (l: LocalItem, a: AdoItem): PlannedAdoUpdate => {
    let u = adoUpdates.get(a.id);
    if (!u) {
      u = { adoId: a.id, localId: l.id, label: `${TYPE_LABEL[l.type]} ${a.id} "${l.title}"`, rev: a.rev, fields: [] };
      adoUpdates.set(a.id, u);
    }
    return u;
  };
  const label = (l: LocalItem, a: AdoItem) => `${TYPE_LABEL[l.type]} ${a.id} "${a.title}"`;

  const decide = <T,>(adoNow: T, localNow: T, snap: T | undefined, adoNewer: boolean, what: string, who: string): "none" | "pull" | "push" => {
    if (adoNow === localNow) return "none";
    if (snap === undefined) return "pull";
    const adoChanged = adoNow !== snap;
    const localChanged = localNow !== snap;
    if (adoChanged && !localChanged) return "pull";
    if (!adoChanged && localChanged) return "push";
    if (!adoChanged && !localChanged) return "none";
    conflicts.push(`${who}: ${what} was changed on both sides; the ${adoNewer ? "Azure DevOps" : "Solo Scrum"} change is the latest and was kept.`);
    return adoNewer ? "pull" : "push";
  };

  // Stories and bugs first, so a moved story can carry its open tasks along.
  const linkedItems = local
    .filter((l) => l.adoId != null && adoById.has(l.adoId))
    .sort((x, y) => (x.type === "TASK" ? 1 : 0) - (y.type === "TASK" ? 1 : 0));
  const pendingLocal = new Map<string, PlannedLocalUpdate>();
  const localUpdateFor = (l: LocalItem, adoId: number, name: string, rev: number): PlannedLocalUpdate => {
    let u = pendingLocal.get(l.id);
    if (!u) {
      u = {
        id: l.id,
        adoId,
        label: name,
        data: {},
        history: [],
        snapshot: l.snapshot ?? { rev, status: l.type === "EPIC" || l.type === "FEATURE" ? null : l.status, assignee: null, sprint: null, hours: null },
      };
      pendingLocal.set(l.id, u);
    }
    return u;
  };

  for (const l of linkedItems) {
    const a = adoById.get(l.adoId as number) as AdoItem;
    linked++;
    if (a.removed) {
      note("removed", `${label(l, a)} was removed in Azure DevOps. It was left as it is here.`);
      continue;
    }
    if (a.type !== l.type) {
      note("type", `${label(l, a)} has a different type in Azure DevOps. It was left as it is here.`);
      continue;
    }
    const snap = l.snapshot;
    const adoNewer = a.changedAt.getTime() > l.updatedAt.getTime();
    const who = label(l, a);
    const lu = (): PlannedLocalUpdate => localUpdateFor(l, a.id, who, a.rev);
    const newSnap: ItemSnapshot = { ...(snap ?? { rev: a.rev, status: null, assignee: null, sprint: null, hours: null }), rev: a.rev };

    // Azure DevOps owns text and place in the hierarchy.
    if (a.title.slice(0, 200) !== l.title) {
      lu().data.title = a.title.slice(0, 200);
      lu().history.push({ field: "title", oldValue: l.title, newValue: a.title.slice(0, 200) });
    }
    if (a.description !== l.description) lu().data.description = a.description;
    if (a.acceptanceCriteria !== l.acceptanceCriteria) lu().data.acceptanceCriteria = a.acceptanceCriteria;
    if (PARENT_TYPES[l.type].length > 0 && a.parentId != null) {
      const p = resolveParent(a);
      if (p && p.id !== l.parentId) {
        lu().data.parentId = p.id;
        lu().history.push({ field: "parent", oldValue: l.parentId, newValue: p.id });
      }
    }

    // Status (stories, bugs, tasks)
    if (a.status != null && (l.type === "STORY" || l.type === "BUG" || l.type === "TASK")) {
      const d = decide<WorkItemStatus>(a.status, l.status, snap?.status ?? undefined, adoNewer, "the status", who);
      if (d === "pull") {
        const u = lu();
        u.data.status = a.status;
        u.data.doneAt = a.status === "DONE" ? (l.status === "DONE" ? undefined : (a.doneAt ?? a.changedAt)) : null;
        u.history.push({ field: "status", oldValue: l.status, newValue: a.status });
        newSnap.status = a.status;
      } else if (d === "push") {
        const state = stateFromStatus(l.type, l.status);
        if (state) {
          adoUpdateFor(l, a).fields.push({
            key: "status",
            ops: [{ op: "add", path: "/fields/System.State", value: state }],
            snapshot: { status: l.status },
          });
        }
      } else newSnap.status = a.status;
    }

    // Assignee (tasks)
    if (l.type === "TASK") {
      const localName = l.assigneeId ? normalizeName(memberById.get(l.assigneeId)?.name) : null;
      const adoName = a.assignee ? normalizeName(a.assignee) : null;
      const d = decide<string | null>(adoName, localName, snap ? snap.assignee : undefined, adoNewer, "the assignee", who);
      if (d === "pull") {
        const m = adoName ? memberByName.get(adoName) : null;
        if (adoName && !m) {
          unknownAssignees.add(a.assignee as string);
        } else {
          const u = lu();
          u.data.assigneeId = m ? m.id : null;
          u.history.push({ field: "assignee", oldValue: l.assigneeId, newValue: m ? m.id : null });
          newSnap.assignee = adoName;
        }
      } else if (d === "push") {
        const name = l.assigneeId ? (memberById.get(l.assigneeId)?.name ?? "") : "";
        adoUpdateFor(l, a).fields.push({
          key: "assignee",
          ops: [{ op: "add", path: "/fields/System.AssignedTo", value: name }],
          snapshot: { assignee: localName },
        });
      } else newSnap.assignee = adoName;
    }

    // Sprint (stories and bugs); their open tasks follow
    if (l.type === "STORY" || l.type === "BUG") {
      const adoPath = a.iterationPath || rootPath;
      const isRoot = (path: string) => path.toLowerCase() === rootPath.toLowerCase();
      let localPath = l.sprintId && !sprintPath.has(l.sprintId) ? undefined : pathOfSprint(l.sprintId);
      let forcePull = false;
      // An item left in the backlog because its sprint did not exist here is remembered with that sprint's path.
      if (!l.sprintId && snap?.sprint && !isRoot(snap.sprint)) {
        const mapped = sprintForPath(snap.sprint);
        if (mapped === undefined) localPath = snap.sprint;
        else if (adoPath.toLowerCase() === snap.sprint.toLowerCase()) forcePull = true;
      }
      if (localPath !== undefined) {
        const d = forcePull
          ? "pull"
          : decide<string>(adoPath.toLowerCase(), localPath.toLowerCase(), snap?.sprint != null ? snap.sprint.toLowerCase() : snap ? rootPath.toLowerCase() : undefined, adoNewer, "the sprint", who);
        if (d === "pull") {
          const target = sprintForPath(adoPath);
          if (target === undefined) {
            note("sprint", `${who} is in sprint "${adoPath}" in Azure DevOps, which does not exist here. Its sprint was not changed.`);
            if (!l.sprintId) newSnap.sprint = adoPath;
          } else if (target && sprintById.get(target)?.state === "CLOSED") {
            // Closed sprints do not take new work. Left alone without remembering it, so nothing is sent back.
          } else {
            const u = lu();
            u.data.sprintId = target;
            u.history.push({ field: "sprint", oldValue: l.sprintId, newValue: target });
            newSnap.sprint = adoPath;
            for (const t of local.filter((x) => x.parentId === l.id && x.type === "TASK" && x.status !== "DONE" && x.sprintId !== target)) {
              const ta = t.adoId != null ? adoById.get(t.adoId) : undefined;
              const tu = localUpdateFor(t, t.adoId ?? a.id, ta ? label(t, ta) : `${TYPE_LABEL[t.type]} "${t.title}"`, ta?.rev ?? a.rev);
              tu.data.sprintId = target;
              tu.history.push({ field: "sprint", oldValue: t.sprintId, newValue: target });
            }
          }
        } else if (d === "push") {
          adoUpdateFor(l, a).fields.push({ key: "sprint", ops: [{ op: "add", path: "/fields/System.IterationPath", value: localPath }], snapshot: { sprint: localPath } });
          for (const t of local.filter((x) => x.parentId === l.id && x.type === "TASK" && x.status !== "DONE" && x.adoId != null)) {
            const ta = adoById.get(t.adoId as number);
            if (ta && !ta.removed && (ta.iterationPath || rootPath).toLowerCase() !== localPath.toLowerCase()) {
              adoUpdateFor(t, ta).fields.push({ key: "sprint", ops: [{ op: "add", path: "/fields/System.IterationPath", value: localPath }], snapshot: { sprint: localPath } });
            }
          }
        } else newSnap.sprint = adoPath;
      }
    }

    // Hours (tasks): sent to Azure DevOps, never read back
    if (l.type === "TASK" && l.estimateHours != null) {
      const remaining = l.status === "DONE" ? 0 : l.estimateHours;
      if (snap?.hours !== remaining) {
        adoUpdateFor(l, a).fields.push({
          key: "hours",
          ops: [{ op: "add", path: "/fields/Microsoft.VSTS.Scheduling.RemainingWork", value: remaining }],
          snapshot: { hours: remaining },
        });
      }
    }

    // Remember the new agreed state when nothing else will write it.
    const u = pendingLocal.get(l.id);
    if (u) u.snapshot = { ...u.snapshot, ...newSnap, hours: u.snapshot.hours };
    else if (JSON.stringify(newSnap) !== JSON.stringify(snap)) snapshotRefresh.push({ id: l.id, snapshot: newSnap });
  }

  localUpdates.push(...pendingLocal.values());

  for (const l of local) {
    if (l.adoId != null && !adoById.has(l.adoId)) note("missing", `${TYPE_LABEL[l.type]} ${l.adoId} "${l.title}" was not found in Azure DevOps (deleted or moved). It was left as it is here.`);
  }
  if (movedUp) note("placement", `${movedUp} item(s) sit under something that is not allowed here (for example a bug under a user story), so they were placed under the nearest feature above instead.`);
  if (lostSprints.size) {
    const total = [...lostSprints.values()].reduce((x, y) => x + y, 0);
    const names = [...lostSprints.keys()].map((p) => p.split("\\").pop()).slice(0, 4).join(", ");
    note("sprint", `${total} new item(s) are in past or unknown sprints (${names}${lostSprints.size > 4 ? ", …" : ""}). They were put in the backlog; create or import those sprints to see them there.`);
  }
  if (skippedOld.length) note("old", `${skippedOld.length} finished item(s) older than the cut-off date were not brought in.`);
  for (const name of unknownAssignees) note("assignee", `"${name}" is assigned in Azure DevOps but is not a member here. Add the member to see the assignment.`);

  return {
    sprintCreates,
    sprintLinks,
    creates,
    localUpdates,
    adoUpdates: [...adoUpdates.values()].filter((u) => u.fields.length > 0),
    snapshotRefresh,
    notes,
    conflicts,
    stats: { adoItems: ado.length, linked, localOnly: local.filter((l) => l.adoId == null).length },
  };
}

// ---------- the report shown to the user ----------

export type SyncSummary = {
  at: string;
  applied: boolean;
  project: string;
  counts: {
    adoItems: number;
    created: number;
    pulled: number;
    pushedItems: number;
    pushedFields: number;
    sprintsCreated: number;
    sprintsLinked: number;
    conflicts: number;
    localOnly: number;
    failed: number;
  };
  /** Short lines for the screen */
  lines: string[];
  errors: string[];
};

/** Groups notes by kind and keeps only a few examples of each so the report stays readable. */
export function summarizeNotes(notes: SyncNote[]): string[] {
  const byKind = new Map<string, string[]>();
  for (const n of notes) byKind.set(n.kind, [...(byKind.get(n.kind) ?? []), n.message]);
  const lines: string[] = [];
  for (const messages of byKind.values()) {
    lines.push(...messages.slice(0, NOTE_EXAMPLES));
    if (messages.length > NOTE_EXAMPLES) lines.push(`…and ${messages.length - NOTE_EXAMPLES} more like this.`);
  }
  return lines;
}

export function describePlan(plan: SyncPlan, opts: { applied: boolean; project: string; failed?: string[]; at?: Date }): SyncSummary {
  const pushedFields = plan.adoUpdates.reduce((n, u) => n + u.fields.length, 0);
  const counts = {
    adoItems: plan.stats.adoItems,
    created: plan.creates.length,
    pulled: plan.localUpdates.length,
    pushedItems: plan.adoUpdates.length,
    pushedFields,
    sprintsCreated: plan.sprintCreates.length,
    sprintsLinked: plan.sprintLinks.length,
    conflicts: plan.conflicts.length,
    localOnly: plan.stats.localOnly,
    failed: opts.failed?.length ?? 0,
  };
  const verb = opts.applied ? "" : "would be ";
  const lines = [
    `${counts.adoItems} work item(s) found in Azure DevOps; ${plan.stats.linked} already linked here.`,
    `${counts.created} new item(s) ${verb}brought in from Azure DevOps.`,
    `${counts.pulled} existing item(s) ${verb}updated here from Azure DevOps.`,
    `${counts.pushedItems} item(s) (${pushedFields} change(s)) ${verb}sent to Azure DevOps.`,
  ];
  if (counts.sprintsCreated || counts.sprintsLinked) lines.push(`${counts.sprintsCreated} sprint(s) ${verb}created and ${counts.sprintsLinked} linked by name.`);
  if (counts.localOnly) lines.push(`${counts.localOnly} item(s) exist only here and are not sent to Azure DevOps (items are never created there).`);
  lines.push(...plan.conflicts.slice(0, NOTE_EXAMPLES));
  if (plan.conflicts.length > NOTE_EXAMPLES) lines.push(`…and ${plan.conflicts.length - NOTE_EXAMPLES} more conflicts.`);
  lines.push(...summarizeNotes(plan.notes));
  return { at: (opts.at ?? new Date()).toISOString(), applied: opts.applied, project: opts.project, counts, lines, errors: opts.failed ?? [] };
}
