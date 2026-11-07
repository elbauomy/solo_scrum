import { describe, expect, it } from "vitest";
import { AdoError, type AdoClient, type PatchOp } from "./ado-client";
import { pushOne } from "./ado-push";
import type { ItemSnapshot, PlannedAdoUpdate } from "./ado-sync";

const snap: ItemSnapshot = { rev: 1, status: "NEW", assignee: null, sprint: "P", hours: null };
const update: PlannedAdoUpdate = {
  adoId: 5, localId: "L", label: 'Task 5 "x"', rev: 3,
  fields: [
    { key: "status", ops: [{ op: "add", path: "/fields/System.State", value: "Done" }], snapshot: { status: "DONE" } },
    { key: "assignee", ops: [{ op: "add", path: "/fields/System.AssignedTo", value: "Nobody" }], snapshot: { assignee: "nobody" } },
    { key: "hours", ops: [{ op: "add", path: "/fields/Microsoft.VSTS.Scheduling.RemainingWork", value: 0 }], snapshot: { hours: 0 } },
  ],
};

function fake(handler: (rev: number, ops: PatchOp[]) => { ok: true; rev: number } | { ok: false; reason: "changed" } | Error) {
  const calls: { rev: number; ops: PatchOp[] }[] = [];
  const api = {
    updateWorkItem: async (_id: number, rev: number, ops: PatchOp[]) => {
      calls.push({ rev, ops });
      const r = handler(rev, ops);
      if (r instanceof Error) throw r;
      return r;
    },
  } as unknown as AdoClient;
  return { api, calls };
}

describe("pushOne", () => {
  it("sends everything in one request when Azure DevOps accepts it", async () => {
    const { api, calls } = fake((rev) => ({ ok: true, rev: rev + 1 }));
    const r = await pushOne(api, update, snap);
    expect(calls).toHaveLength(1);
    expect(r.errors).toEqual([]);
    expect(r.snapshot).toEqual({ rev: 4, status: "DONE", assignee: "nobody", sprint: "P", hours: 0 });
  });

  it("when one field is refused, the others still go through and only they are remembered", async () => {
    const { api, calls } = fake((rev, ops) =>
      ops.some((o) => o.path === "/fields/System.AssignedTo") ? new AdoError("Azure DevOps said: could not find Nobody") : { ok: true, rev: rev + 1 },
    );
    const r = await pushOne(api, update, snap);
    expect(calls).toHaveLength(4); // all together, then each field alone
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain("assignee");
    expect(r.snapshot).toMatchObject({ status: "DONE", assignee: null, hours: 0, rev: 5 });
  });

  it("reports a concurrent change and remembers nothing", async () => {
    const { api } = fake(() => ({ ok: false, reason: "changed" }));
    const r = await pushOne(api, update, snap);
    expect(r.snapshot).toBeUndefined();
    expect(r.errors[0]).toContain("changed in Azure DevOps while syncing");
  });

  it("reports the reason when a single change is refused", async () => {
    const { api } = fake(() => new AdoError("Azure DevOps said: nope"));
    const r = await pushOne(api, { ...update, fields: [update.fields[0]] }, snap);
    expect(r.snapshot).toBeUndefined();
    expect(r.errors).toEqual(['Task 5 "x": Azure DevOps said: nope']);
  });
});
