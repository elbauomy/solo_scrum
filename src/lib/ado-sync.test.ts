import { describe, expect, it } from "vitest";
import {
  htmlToText, planSync, statusFromState, stateFromStatus, toAdoItem, describePlan,
  type AdoItem, type LocalItem, type LocalSprint, type SyncInput, type ItemSnapshot,
} from "./ado-sync";

const T0 = new Date("2026-11-01T10:00:00Z");
const EARLIER = new Date("2026-10-01T10:00:00Z");
const LATER = new Date("2026-11-02T10:00:00Z");

let counter = 0;
const newId = () => `new${++counter}`;

function ado(p: Partial<AdoItem> & { id: number; type: AdoItem["type"] }): AdoItem {
  const status = p.type === "EPIC" || p.type === "FEATURE" ? null : p.type === "TASK" ? "NEW" : "NEW";
  return {
    rev: 1, state: "New", status, removed: false, finished: false, title: `Item ${p.id}`, description: "", acceptanceCriteria: "",
    iterationPath: "PROJ", assignee: null, priority: "MEDIUM", parentId: null, changedAt: T0, createdAt: EARLIER, doneAt: null, backlogRank: null, hours: null,
    ...p,
  };
}

function loc(p: Partial<LocalItem> & { id: string; type: LocalItem["type"]; adoId: number | null }): LocalItem {
  return {
    status: "NEW", title: `Item ${p.adoId}`, description: "", acceptanceCriteria: "", parentId: null, assigneeId: null, sprintId: null,
    estimateHours: null, updatedAt: T0, snapshot: null, ...p,
  };
}

const snap = (p: Partial<ItemSnapshot> = {}): ItemSnapshot => ({ rev: 1, status: "NEW", assignee: null, sprint: "PROJ", hours: null, ...p });

function input(p: Partial<SyncInput>): SyncInput {
  return {
    project: "PROJ", today: new Date("2026-11-03T00:00:00Z"), ado: [], iterations: [], local: [], sprints: [],
    members: [{ id: "m-sara", name: "Sara Ali" }, { id: "m-omar", name: "Omar Hassan" }], newId, skipFinishedBefore: null, ...p,
  };
}

describe("reading Azure DevOps", () => {
  it("turns HTML into plain text", () => {
    expect(htmlToText("<div>Hello&nbsp;<b>world</b></div><div>Line &amp; two</div><ul><li>a</li><li>b</li></ul>")).toBe("Hello world\nLine & two\n• a\n• b");
    expect(htmlToText("")).toBe("");
  });

  it("maps states both ways", () => {
    expect(statusFromState("STORY", "Committed")).toBe("COMMITTED");
    expect(statusFromState("BUG", "Approved")).toBe("APPROVED");
    expect(statusFromState("TASK", "To Do")).toBe("NEW");
    expect(statusFromState("TASK", "In Progress")).toBe("IN_PROGRESS");
    expect(statusFromState("STORY", "Removed")).toBeNull();
    expect(statusFromState("EPIC", "Done")).toBeNull();
    expect(stateFromStatus("TASK", "NEW")).toBe("To Do");
    expect(stateFromStatus("STORY", "COMMITTED")).toBe("Committed");
    expect(stateFromStatus("STORY", "IN_PROGRESS")).toBeNull();
    expect(stateFromStatus("FEATURE", "NEW")).toBeNull();
  });

  it("converts a raw work item and ignores unsupported types", () => {
    const item = toAdoItem({
      id: 7, rev: 3,
      fields: {
        "System.WorkItemType": "Product Backlog Item", "System.State": "Committed", "System.Title": " Login ",
        "System.Description": "<p>As a user</p>", "System.AssignedTo": { displayName: "Sara Ali" }, "System.IterationPath": "PROJ\\Sprint 1",
        "System.Parent": 5, "Microsoft.VSTS.Common.Priority": 1, "System.ChangedDate": "2026-11-01T10:00:00Z",
      },
    });
    expect(item).toMatchObject({ id: 7, type: "STORY", status: "COMMITTED", title: "Login", description: "As a user", assignee: "Sara Ali", parentId: 5, priority: "HIGH" });
    expect(toAdoItem({ id: 8, rev: 1, fields: { "System.WorkItemType": "Test Case", "System.State": "Design" } })).toBeNull();
    expect(toAdoItem({ id: 9, rev: 1, fields: { "System.WorkItemType": "Task", "System.State": "Done" } })).toMatchObject({ finished: true, status: "DONE" });
  });
});

describe("bringing in new items", () => {
  it("creates the hierarchy parents first, with ranks, priority and assignee", () => {
    const plan = planSync(input({
      ado: [
        ado({ id: 4, type: "TASK", parentId: 3, state: "To Do", assignee: "sara  ali", backlogRank: 5 }),
        ado({ id: 3, type: "STORY", parentId: 2, state: "Approved", status: "APPROVED", priority: "HIGH" }),
        ado({ id: 2, type: "FEATURE", parentId: 1 }),
        ado({ id: 1, type: "EPIC" }),
      ],
    }));
    expect(plan.creates.map((c) => c.adoId)).toEqual([1, 2, 3, 4]);
    const [epic, feature, story, task] = plan.creates;
    expect(feature.parentId).toBe(epic.id);
    expect(story.parentId).toBe(feature.id);
    expect(task.parentId).toBe(story.id);
    expect(story).toMatchObject({ status: "APPROVED", priority: "HIGH" });
    expect(task.assigneeId).toBe("m-sara");
    expect(task.snapshot.assignee).toBe("sara ali");
    expect(epic.rank).toBe(1);
  });

  it("skips items that cannot be placed and says so", () => {
    const plan = planSync(input({
      ado: [
        ado({ id: 1, type: "FEATURE" }), // needs an epic
        ado({ id: 2, type: "STORY", parentId: 1 }), // fine: parentless story
        ado({ id: 3, type: "TASK" }), // needs a story
        ado({ id: 4, type: "STORY", parentId: 99 }), // parent not in this project
      ],
    }));
    expect(plan.creates.map((c) => c.adoId).sort()).toEqual([2, 4]);
    expect(plan.creates.find((c) => c.adoId === 2)?.parentId).toBeNull();
    expect(plan.notes.filter((n) => n.kind === "skipped")).toHaveLength(2);
  });

  it("places a story under an epic without a parent (not allowed here)", () => {
    const plan = planSync(input({ ado: [ado({ id: 1, type: "EPIC" }), ado({ id: 2, type: "STORY", parentId: 1 })] }));
    expect(plan.creates.find((c) => c.adoId === 2)?.parentId).toBeNull();
  });

  it("puts a bug that sits under a user story under that story's feature, quietly after the first time", () => {
    const items = [
      ado({ id: 1, type: "EPIC" }), ado({ id: 2, type: "FEATURE", parentId: 1 }),
      ado({ id: 3, type: "STORY", parentId: 2 }), ado({ id: 4, type: "BUG", parentId: 3 }), ado({ id: 5, type: "TASK", parentId: 4 }),
    ];
    const first = planSync(input({ ado: items }));
    const feature = first.creates.find((c) => c.adoId === 2)!;
    const bug = first.creates.find((c) => c.adoId === 4)!;
    expect(bug.parentId).toBe(feature.id);
    expect(first.creates.find((c) => c.adoId === 5)?.parentId).toBe(bug.id);
    expect(first.notes.filter((n) => n.kind === "placement")).toHaveLength(1);
    // Next sync: nothing to move, no more notes.
    const local = first.creates.map((c) => loc({ id: c.id, type: c.type, adoId: c.adoId, parentId: c.parentId, title: c.title, snapshot: c.snapshot, status: c.status }));
    const again = planSync(input({ ado: items, local }));
    expect(again.localUpdates).toHaveLength(0);
    expect(again.notes).toHaveLength(0);
  });

  it("never brings in removed items", () => {
    const plan = planSync(input({ ado: [ado({ id: 1, type: "STORY", removed: true, status: null, state: "Removed" })] }));
    expect(plan.creates).toHaveLength(0);
  });

  it("skips old finished items but keeps a parent that still has open work", () => {
    const old = new Date("2026-01-01T00:00:00Z");
    const plan = planSync(input({
      skipFinishedBefore: new Date("2026-09-01T00:00:00Z"),
      ado: [
        ado({ id: 1, type: "EPIC", finished: true, changedAt: old }),
        ado({ id: 2, type: "FEATURE", parentId: 1, finished: true, changedAt: old }),
        ado({ id: 3, type: "STORY", parentId: 2, finished: true, changedAt: old, state: "Done", status: "DONE" }),
        ado({ id: 4, type: "TASK", parentId: 3, finished: true, changedAt: old, state: "Done", status: "DONE" }),
        ado({ id: 10, type: "EPIC", finished: true, changedAt: old }),
        ado({ id: 11, type: "FEATURE", parentId: 10, finished: true, changedAt: old }),
        ado({ id: 12, type: "STORY", parentId: 11, state: "Committed", status: "COMMITTED", changedAt: LATER }),
      ],
    }));
    expect(plan.creates.map((c) => c.adoId).sort((a, b) => a - b)).toEqual([10, 11, 12]);
    expect(plan.notes.find((n) => n.kind === "old")?.message).toContain("4 finished item(s)");
  });

  it("sets Done items' finish date and a task follows its story's sprint", () => {
    const sprints: LocalSprint[] = [{ id: "sp1", name: "Sprint 1", adoPath: "PROJ\\Sprint 1", state: "ACTIVE" }];
    const done = new Date("2026-10-20T00:00:00Z");
    const plan = planSync(input({
      sprints,
      ado: [
        ado({ id: 1, type: "FEATURE", parentId: undefined }),
        ado({ id: 2, type: "EPIC" }),
        ado({ id: 3, type: "STORY", iterationPath: "PROJ\\Sprint 1" }),
        ado({ id: 4, type: "TASK", parentId: 3, iterationPath: "PROJ" }),
        ado({ id: 5, type: "TASK", parentId: 3, state: "Done", status: "DONE", doneAt: done }),
      ],
    }));
    const story = plan.creates.find((c) => c.adoId === 3)!;
    expect(story.sprintId).toBe("sp1");
    expect(plan.creates.find((c) => c.adoId === 4)?.sprintId).toBe("sp1");
    expect(plan.creates.find((c) => c.adoId === 5)?.doneAt).toEqual(done);
  });

  it("notes assignees that are not members", () => {
    const plan = planSync(input({ ado: [ado({ id: 1, type: "STORY" }), ado({ id: 2, type: "TASK", parentId: 1, assignee: "Nobody Known" })] }));
    expect(plan.creates.find((c) => c.adoId === 2)?.assigneeId).toBeNull();
    expect(plan.notes.find((n) => n.kind === "assignee")?.message).toContain("Nobody Known");
  });
});

describe("sprints", () => {
  const iterations = [
    { path: "PROJ\\Release 5\\Sprint 60", name: "Sprint 60", startDate: "2026-10-04T00:00:00Z", finishDate: "2026-10-15T00:00:00Z" },
    { path: "PROJ\\Release 6\\Sprint 62", name: "Sprint 62", startDate: "2026-11-01T00:00:00Z", finishDate: "2026-12-10T00:00:00Z" },
    { path: "PROJ\\Release 6\\Sprint 63", name: "Sprint 63", startDate: null, finishDate: null },
  ];
  it("links by name and creates only sprints that have not ended", () => {
    const plan = planSync(input({ iterations, sprints: [{ id: "s60", name: "sprint 60", adoPath: null, state: "CLOSED" }] }));
    expect(plan.sprintLinks).toEqual([{ id: "s60", adoPath: "PROJ\\Release 5\\Sprint 60" }]);
    expect(plan.sprintCreates).toHaveLength(1);
    expect(plan.sprintCreates[0]).toMatchObject({ name: "Sprint 62", startDate: "2026-11-01", endDate: "2026-12-10" });
  });

  it("puts new stories into a sprint created in the same run", () => {
    const plan = planSync(input({ iterations, ado: [ado({ id: 1, type: "STORY", iterationPath: "PROJ\\Release 6\\Sprint 62" })] }));
    expect(plan.creates[0].sprintId).toBe(plan.sprintCreates[0].id);
  });
});

describe("items that are already linked", () => {
  const base = () => ({
    story: loc({ id: "L1", type: "STORY", adoId: 1, status: "COMMITTED", snapshot: snap({ status: "COMMITTED" }) }),
    adoStory: ado({ id: 1, type: "STORY", state: "Committed", status: "COMMITTED", rev: 4 }),
  });

  it("does nothing when nothing changed", () => {
    const { story, adoStory } = base();
    const plan = planSync(input({ ado: [adoStory], local: [story] }));
    expect(plan.localUpdates).toHaveLength(0);
    expect(plan.adoUpdates).toHaveLength(0);
    expect(plan.creates).toHaveLength(0);
  });

  it("pulls text changes from Azure DevOps", () => {
    const { story, adoStory } = base();
    const plan = planSync(input({ ado: [{ ...adoStory, title: "New title", description: "More" }], local: [story] }));
    expect(plan.localUpdates[0].data).toMatchObject({ title: "New title", description: "More" });
    expect(plan.adoUpdates).toHaveLength(0);
  });

  it("pulls a status changed in Azure DevOps and marks Done with its date", () => {
    const { story, adoStory } = base();
    const doneAt = new Date("2026-11-02T08:00:00Z");
    const plan = planSync(input({ ado: [{ ...adoStory, state: "Done", status: "DONE", doneAt }], local: [story] }));
    expect(plan.localUpdates[0].data).toMatchObject({ status: "DONE", doneAt });
    expect(plan.localUpdates[0].history).toContainEqual({ field: "status", oldValue: "COMMITTED", newValue: "DONE" });
    expect(plan.localUpdates[0].snapshot.status).toBe("DONE");
  });

  it("pushes a status changed here", () => {
    const { story, adoStory } = base();
    const plan = planSync(input({ ado: [adoStory], local: [{ ...story, status: "DONE" }] }));
    expect(plan.localUpdates).toHaveLength(0);
    expect(plan.adoUpdates).toHaveLength(1);
    expect(plan.adoUpdates[0]).toMatchObject({ adoId: 1, rev: 4 });
    expect(plan.adoUpdates[0].fields[0]).toMatchObject({ key: "status", ops: [{ op: "add", path: "/fields/System.State", value: "Done" }], snapshot: { status: "DONE" } });
  });

  it("on a conflict the most recent change wins", () => {
    const { story, adoStory } = base();
    const adoNewer = planSync(input({
      ado: [{ ...adoStory, state: "Approved", status: "APPROVED", changedAt: LATER }],
      local: [{ ...story, status: "DONE", updatedAt: T0 }],
    }));
    expect(adoNewer.localUpdates[0].data.status).toBe("APPROVED");
    expect(adoNewer.adoUpdates).toHaveLength(0);
    expect(adoNewer.conflicts).toHaveLength(1);

    const localNewer = planSync(input({
      ado: [{ ...adoStory, state: "Approved", status: "APPROVED", changedAt: T0 }],
      local: [{ ...story, status: "DONE", updatedAt: LATER }],
    }));
    expect(localNewer.localUpdates).toHaveLength(0);
    expect(localNewer.adoUpdates[0].fields[0].ops[0].value).toBe("Done");
    expect(localNewer.conflicts).toHaveLength(1);
  });

  it("does not sync the status of epics and features", () => {
    const plan = planSync(input({
      ado: [ado({ id: 1, type: "FEATURE", parentId: 9, state: "Done" }), ado({ id: 9, type: "EPIC" })],
      local: [loc({ id: "F", type: "FEATURE", adoId: 1, snapshot: snap({ status: null }) }), loc({ id: "E", type: "EPIC", adoId: 9, snapshot: snap({ status: null }) })],
    }));
    expect(plan.localUpdates.flatMap((u) => Object.keys(u.data)).includes("status")).toBe(false);
    expect(plan.adoUpdates).toHaveLength(0);
  });

  it("syncs the assignee both ways and notes unknown people", () => {
    const task = loc({ id: "T", type: "TASK", adoId: 2, parentId: "L1", snapshot: snap({ assignee: null }) });
    const adoTask = ado({ id: 2, type: "TASK", parentId: 1, assignee: "Omar Hassan" });
    const { story, adoStory } = base();
    const pulled = planSync(input({ ado: [adoStory, adoTask], local: [story, task] }));
    expect(pulled.localUpdates.find((u) => u.id === "T")?.data.assigneeId).toBe("m-omar");

    const pushed = planSync(input({ ado: [adoStory, { ...adoTask, assignee: null }], local: [story, { ...task, assigneeId: "m-sara" }] }));
    expect(pushed.adoUpdates.find((u) => u.adoId === 2)?.fields[0]).toMatchObject({ key: "assignee", ops: [{ path: "/fields/System.AssignedTo", value: "Sara Ali" }] });

    const unknown = planSync(input({ ado: [adoStory, { ...adoTask, assignee: "Someone New" }], local: [story, task] }));
    expect(unknown.localUpdates.find((u) => u.id === "T")).toBeUndefined();
    expect(unknown.notes.some((n) => n.kind === "assignee")).toBe(true);
  });

  it("pushes a sprint changed here, and the open tasks follow", () => {
    const sprints: LocalSprint[] = [{ id: "sp1", name: "Sprint 1", adoPath: "PROJ\\Sprint 1", state: "ACTIVE" }];
    const story = loc({ id: "L1", type: "STORY", adoId: 1, sprintId: "sp1", snapshot: snap({ sprint: "PROJ" }) });
    const open = loc({ id: "T1", type: "TASK", adoId: 2, parentId: "L1", sprintId: "sp1", snapshot: snap({ sprint: "PROJ" }) });
    const done = loc({ id: "T2", type: "TASK", adoId: 3, parentId: "L1", status: "DONE", sprintId: "sp1", snapshot: snap({ status: "DONE", sprint: "PROJ", hours: 0 }) });
    const plan = planSync(input({
      sprints,
      ado: [ado({ id: 1, type: "STORY" }), ado({ id: 2, type: "TASK", parentId: 1 }), ado({ id: 3, type: "TASK", parentId: 1, state: "Done", status: "DONE" })],
      local: [story, open, done],
    }));
    const paths = plan.adoUpdates.map((u) => [u.adoId, u.fields.map((f) => f.key)]);
    expect(paths).toEqual([[1, ["sprint"]], [2, ["sprint"]]]);
    expect(plan.adoUpdates[0].fields[0].ops[0]).toMatchObject({ path: "/fields/System.IterationPath", value: "PROJ\\Sprint 1" });
  });

  it("pulls a sprint changed in Azure DevOps and moves open tasks", () => {
    const sprints: LocalSprint[] = [{ id: "sp1", name: "Sprint 1", adoPath: "PROJ\\Sprint 1", state: "ACTIVE" }];
    const story = loc({ id: "L1", type: "STORY", adoId: 1, snapshot: snap({ sprint: "PROJ" }) });
    const task = loc({ id: "T1", type: "TASK", adoId: 2, parentId: "L1", snapshot: snap({ sprint: "PROJ" }) });
    const plan = planSync(input({
      sprints,
      ado: [ado({ id: 1, type: "STORY", iterationPath: "PROJ\\Sprint 1" }), ado({ id: 2, type: "TASK", parentId: 1 })],
      local: [story, task],
    }));
    expect(plan.localUpdates.find((u) => u.id === "L1")?.data.sprintId).toBe("sp1");
    expect(plan.localUpdates.find((u) => u.id === "T1")?.data.sprintId).toBe("sp1");
    expect(plan.adoUpdates).toHaveLength(0);
  });

  it("keeps quiet about a past sprint that is not here, and fills it in once the sprint exists", () => {
    const items = [ado({ id: 1, type: "STORY", iterationPath: "PROJ\\Sprint 61" })];
    const first = planSync(input({ ado: items }));
    expect(first.notes.filter((n) => n.kind === "sprint")).toHaveLength(1);
    const c = first.creates[0];
    const local = [loc({ id: c.id, type: "STORY", adoId: 1, snapshot: c.snapshot })];
    const again = planSync(input({ ado: items, local }));
    expect(again.notes).toHaveLength(0);
    expect(again.adoUpdates).toHaveLength(0);
    expect(again.snapshotRefresh).toHaveLength(0);
    // The sprint is created here later: the story is placed in it, never pushed to the backlog.
    const sprints: LocalSprint[] = [{ id: "sp61", name: "Sprint 61", adoPath: "PROJ\\Sprint 61", state: "ACTIVE" }];
    const later = planSync(input({ ado: items, local, sprints }));
    expect(later.adoUpdates).toHaveLength(0);
    expect(later.localUpdates[0].data.sprintId).toBe("sp61");
    // ...and a closed sprint is left alone without anything being sent back.
    const closed = planSync(input({ ado: items, local, sprints: [{ ...sprints[0], state: "CLOSED" }] }));
    expect(closed.adoUpdates).toHaveLength(0);
    expect(closed.localUpdates).toHaveLength(0);
  });

  it("brings in task hours from Azure DevOps the first time and does not send them back", () => {
    const items = [ado({ id: 1, type: "STORY" }), ado({ id: 2, type: "TASK", parentId: 1, hours: 6 }), ado({ id: 3, type: "TASK", parentId: 1, hours: 4, state: "Done", status: "DONE" })];
    const first = planSync(input({ ado: items }));
    expect(first.creates.find((c) => c.adoId === 2)).toMatchObject({ estimateHours: 6, snapshot: { hours: 6 } });
    expect(first.creates.find((c) => c.adoId === 3)).toMatchObject({ estimateHours: 4, snapshot: { hours: 0 } });
    const local = first.creates.map((c) => loc({ id: c.id, type: c.type, adoId: c.adoId, parentId: c.parentId, status: c.status, estimateHours: c.estimateHours, snapshot: c.snapshot, title: c.title }));
    expect(planSync(input({ ado: items, local })).adoUpdates).toHaveLength(0);
  });

  it("never pushes an unknown sprint back to the backlog", () => {
    // Created while its sprint was unknown here...
    const first = planSync(input({ ado: [ado({ id: 1, type: "STORY", iterationPath: "PROJ\\Old Sprint" })] }));
    const created = first.creates[0];
    expect(created.sprintId).toBeNull();
    // ...then synced again: it must not be moved to the root iteration in Azure DevOps.
    const again = planSync(input({
      ado: [ado({ id: 1, type: "STORY", iterationPath: "PROJ\\Old Sprint" })],
      local: [loc({ id: created.id, type: "STORY", adoId: 1, snapshot: created.snapshot })],
    }));
    expect(again.adoUpdates).toHaveLength(0);
    expect(again.notes).toHaveLength(0);
  });

  it("does not move items into a closed sprint", () => {
    const sprints: LocalSprint[] = [{ id: "sp9", name: "Sprint 9", adoPath: "PROJ\\Sprint 9", state: "CLOSED" }];
    const plan = planSync(input({
      sprints,
      ado: [ado({ id: 1, type: "STORY", iterationPath: "PROJ\\Sprint 9" })],
      local: [loc({ id: "L1", type: "STORY", adoId: 1, snapshot: snap({ sprint: "PROJ" }) })],
    }));
    expect(plan.localUpdates).toHaveLength(0);
  });

  it("sends task hours to Azure DevOps only when they change, and 0 once Done", () => {
    const { story, adoStory } = base();
    const task = loc({ id: "T", type: "TASK", adoId: 2, parentId: "L1", estimateHours: 6, snapshot: snap({ hours: null }) });
    const adoTask = ado({ id: 2, type: "TASK", parentId: 1 });
    const first = planSync(input({ ado: [adoStory, adoTask], local: [story, task] }));
    expect(first.adoUpdates[0].fields[0]).toMatchObject({ key: "hours", ops: [{ path: "/fields/Microsoft.VSTS.Scheduling.RemainingWork", value: 6 }] });
    const same = planSync(input({ ado: [adoStory, adoTask], local: [story, { ...task, snapshot: snap({ hours: 6 }) }] }));
    expect(same.adoUpdates).toHaveLength(0);
    const done = planSync(input({
      ado: [adoStory, { ...adoTask, state: "Done", status: "DONE" }],
      local: [story, { ...task, status: "DONE", snapshot: snap({ hours: 6, status: "DONE" }) }],
    }));
    expect(done.adoUpdates[0].fields[0].ops[0].value).toBe(0);
    const none = planSync(input({ ado: [adoStory, adoTask], local: [story, { ...task, estimateHours: null }] }));
    expect(none.adoUpdates).toHaveLength(0);
  });

  it("leaves removed and missing items alone and says so", () => {
    const plan = planSync(input({
      ado: [ado({ id: 1, type: "STORY", removed: true, status: null, state: "Removed", title: "Gone" })],
      local: [loc({ id: "L1", type: "STORY", adoId: 1 }), loc({ id: "L2", type: "STORY", adoId: 2 }), loc({ id: "L3", type: "STORY", adoId: null })],
    }));
    expect(plan.localUpdates).toHaveLength(0);
    expect(plan.adoUpdates).toHaveLength(0);
    expect(plan.notes.map((n) => n.kind).sort()).toEqual(["missing", "removed"]);
    expect(plan.stats.localOnly).toBe(1);
  });

  it("follows a story moved to another parent in Azure DevOps", () => {
    const plan = planSync(input({
      ado: [ado({ id: 10, type: "FEATURE" }), ado({ id: 11, type: "FEATURE" }), ado({ id: 1, type: "STORY", parentId: 11 })],
      local: [
        loc({ id: "F1", type: "FEATURE", adoId: 10, snapshot: snap({ status: null }) }),
        loc({ id: "F2", type: "FEATURE", adoId: 11, snapshot: snap({ status: null }) }),
        loc({ id: "S", type: "STORY", adoId: 1, parentId: "F1", snapshot: snap() }),
      ],
    }));
    expect(plan.localUpdates.find((u) => u.id === "S")?.data.parentId).toBe("F2");
  });

  it("describes the plan for the screen", () => {
    const plan = planSync(input({ ado: [ado({ id: 1, type: "STORY" })] }));
    const preview = describePlan(plan, { applied: false, project: "PROJ" });
    expect(preview.lines[1]).toContain("1 new item(s) would be brought in");
    expect(describePlan(plan, { applied: true, project: "PROJ" }).lines[1]).not.toContain("would be");
  });
});
