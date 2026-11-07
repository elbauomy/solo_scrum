import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "./db";
import { AdoClient, adoConfigFromEnv } from "./ado-client";
import { pushOne } from "./ado-push";
import {
  describePlan, planSync, toAdoItem, type ItemSnapshot, type LocalItem, type SyncPlan, type SyncSummary,
} from "./ado-sync";
import { parseDate, todayUTC } from "./dates";
import { UserError } from "./sprint-ops";

/** Finished items older than this are not brought in the first time (they only clutter the backlog). */
export const OLD_FINISHED_DAYS = 60;
/** Stop sending changes after this long so the request stays inside the hosting time limit; the next sync continues. */
const PUSH_BUDGET_MS = 35_000;
const PUSH_PARALLEL = 4;

export function adoClientFromEnv(): AdoClient {
  const cfg = adoConfigFromEnv(process.env);
  if (!cfg) throw new UserError("Azure DevOps is not connected yet. Add ADO_ORG and ADO_PAT in the hosting settings (see the user guide).");
  return new AdoClient(cfg);
}

type Loaded = { plan: SyncPlan; project: string; local: LocalItem[] };

/** Reads both sides and works out what a sync would do. Changes nothing. */
async function loadPlan(lobId: string, includeOld: boolean, api: AdoClient): Promise<Loaded & { lobName: string }> {
  const lob = await db.lineOfBusiness.findUnique({ where: { id: lobId } });
  if (!lob) throw new UserError("This line of business no longer exists.");
  if (!lob.adoProject) throw new UserError("Choose the Azure DevOps project for this line of business first.");
  const project = lob.adoProject;

  const [ids, iterations] = await Promise.all([api.listWorkItemIds(project), api.listIterations(project)]);
  const raw = await api.getWorkItems(ids);
  const ado = raw.map(toAdoItem).filter((a): a is NonNullable<typeof a> => a != null);

  const [items, sprints, members] = await Promise.all([
    db.workItem.findMany({ where: { lobId } }),
    db.sprint.findMany({ where: { lobId } }),
    db.member.findMany({ select: { id: true, name: true } }),
  ]);
  const local: LocalItem[] = items.map((i) => ({
    id: i.id, adoId: i.adoId, type: i.type, status: i.status, title: i.title, description: i.description,
    acceptanceCriteria: i.acceptanceCriteria, parentId: i.parentId, assigneeId: i.assigneeId, sprintId: i.sprintId,
    estimateHours: i.estimateHours, updatedAt: i.updatedAt, snapshot: (i.adoSnapshot as ItemSnapshot | null) ?? null,
  }));
  const cutoff = includeOld ? null : new Date(Date.now() - OLD_FINISHED_DAYS * 24 * 60 * 60 * 1000);
  const plan = planSync({
    project, today: todayUTC(), ado, iterations, local,
    sprints: sprints.map((s) => ({ id: s.id, name: s.name, adoPath: s.adoPath, state: s.state })),
    members, newId: () => randomUUID(), skipFinishedBefore: cutoff,
  });
  return { plan, project, local, lobName: lob.name };
}

/** Shows what a sync would do, without changing anything on either side. */
export async function checkLobSync(lobId: string, includeOld: boolean): Promise<SyncSummary> {
  const { plan, project } = await loadPlan(lobId, includeOld, adoClientFromEnv());
  return describePlan(plan, { applied: false, project });
}

/** Runs the sync: brings Azure DevOps changes in, then sends ours. */
export async function runLobSync(lobId: string, includeOld: boolean): Promise<SyncSummary> {
  const api = adoClientFromEnv();
  const { plan, project, local } = await loadPlan(lobId, includeOld, api);

  // 1. Changes in Solo Scrum (one transaction: all or nothing).
  const snapshots = new Map<string, ItemSnapshot>();
  for (const l of local) if (l.snapshot) snapshots.set(l.id, l.snapshot);
  for (const u of plan.localUpdates) snapshots.set(u.id, u.snapshot);
  for (const r of plan.snapshotRefresh) snapshots.set(r.id, r.snapshot);
  for (const c of plan.creates) snapshots.set(c.id, c.snapshot);

  try {
    await db.$transaction(
      async (tx) => {
        if (plan.sprintCreates.length) {
          await tx.sprint.createMany({
            data: plan.sprintCreates.map((s) => ({ id: s.id, lobId, name: s.name, adoPath: s.adoPath, startDate: parseDate(s.startDate), endDate: parseDate(s.endDate) })),
          });
        }
        for (const l of plan.sprintLinks) await tx.sprint.update({ where: { id: l.id }, data: { adoPath: l.adoPath } });

        if (plan.creates.length) {
          const lob = await tx.lineOfBusiness.update({
            where: { id: lobId },
            data: { nextItemNumber: { increment: plan.creates.length } },
            select: { nextItemNumber: true },
          });
          const first = lob.nextItemNumber - plan.creates.length;
          for (let i = 0; i < plan.creates.length; i += 500) {
            const chunk = plan.creates.slice(i, i + 500);
            await tx.workItem.createMany({
              data: chunk.map((c, k) => ({
                id: c.id, type: c.type, number: first + i + k, estimateHours: c.estimateHours, title: c.title, description: c.description, acceptanceCriteria: c.acceptanceCriteria,
                status: c.status, priority: c.priority, rank: c.rank, lobId, parentId: c.parentId, assigneeId: c.assigneeId,
                sprintId: c.sprintId, adoId: c.adoId, adoSnapshot: c.snapshot as unknown as Prisma.InputJsonValue, createdAt: c.createdAt, doneAt: c.doneAt,
              })),
            });
            await tx.workItemHistory.createMany({
              data: chunk.map((c) => ({ workItemId: c.id, field: "created", newValue: c.type, changedAt: c.createdAt })),
            });
          }
        }

        for (const u of plan.localUpdates) {
          await tx.workItem.update({
            where: { id: u.id },
            data: { ...u.data, adoSnapshot: u.snapshot as unknown as Prisma.InputJsonValue },
          });
          if (u.history.length) await tx.workItemHistory.createMany({ data: u.history.map((h) => ({ workItemId: u.id, ...h })) });
        }
        for (const r of plan.snapshotRefresh) {
          await tx.workItem.update({ where: { id: r.id }, data: { adoSnapshot: r.snapshot as unknown as Prisma.InputJsonValue } });
        }
      },
      { timeout: 50_000, maxWait: 10_000 },
    );
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new UserError("Another sync is already running or just finished. Wait a moment and check again.");
    }
    throw err;
  }

  // 2. Changes in Azure DevOps. Each item is independent, so one failure does not stop the others.
  const failed: string[] = [];
  const done: { id: string; snapshot: ItemSnapshot }[] = [];
  const deadline = Date.now() + PUSH_BUDGET_MS;
  const queue = [...plan.adoUpdates];
  let postponed = 0;
  const worker = async () => {
    for (;;) {
      if (Date.now() > deadline) {
        postponed += queue.length;
        queue.length = 0;
        return;
      }
      const u = queue.shift();
      if (!u) return;
      const result = await pushOne(api, u, snapshots.get(u.localId));
      if (result.snapshot) done.push({ id: u.localId, snapshot: result.snapshot });
      failed.push(...result.errors);
    }
  };
  await Promise.all(Array.from({ length: PUSH_PARALLEL }, worker));
  // An item can be pushed once only (the queue is shared), so snapshots never overlap between workers.
  for (let i = 0; i < done.length; i += 50) {
    await db.$transaction(done.slice(i, i + 50).map((d) => db.workItem.update({ where: { id: d.id }, data: { adoSnapshot: d.snapshot as unknown as Prisma.InputJsonValue } })));
  }
  if (postponed) failed.push(`${postponed} change(s) were postponed to keep this request short. Press "Sync now" again to send them.`);

  const summary = describePlan(plan, { applied: true, project, failed });
  await db.lineOfBusiness.update({
    where: { id: lobId },
    data: { adoLastSyncAt: new Date(), adoLastResult: summary as unknown as Prisma.InputJsonValue },
  });
  return summary;
}
