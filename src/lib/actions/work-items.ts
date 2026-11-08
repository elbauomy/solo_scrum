"use server";

import type { WorkItemStatus, WorkItemType } from "@/lib/enums";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { db, type Tx } from "@/lib/db";
import { type ActionState, toActionError } from "@/lib/action-state";
import { PARENT_TYPES, PRIORITIES, TYPES, itemKey, nextRank, statusesFor, TYPE_LABEL, validateParent } from "@/lib/work-items";

const optionalId = z.preprocess((v) => (v === "" || v == null ? null : String(v)), z.string().nullable());
const hours = z.preprocess(
  (v) => (v === "" || v == null ? null : Number(v)),
  z.number({ message: "Hours must be a number" }).min(0, "Hours cannot be negative").max(1000, "Hours must be 1000 or less").nullable(),
);

const createSchema = z.object({
  type: z.enum(TYPES as [WorkItemType, ...WorkItemType[]]),
  title: z.string().trim().min(1, "Title is required").max(200, "Title is too long"),
  lobId: optionalId,
  parentId: optionalId,
  priority: z.enum(PRIORITIES as [string, ...string[]]).default("MEDIUM"),
  assigneeId: optionalId,
  estimateHours: hours,
});

async function assertAssignee(tx: Tx, assigneeId: string | null, lobId: string) {
  if (!assigneeId) return;
  const lob = await tx.lineOfBusiness.findUniqueOrThrow({ where: { id: lobId }, select: { squadId: true } });
  const inSquad = await tx.squadMembership.findFirst({ where: { memberId: assigneeId, squadId: lob.squadId } });
  if (!inSquad) throw new UserError("The assignee must be a member of the squad that owns this line of business.");
}

class UserError extends Error {}

function fail(err: unknown): ActionState {
  if (err instanceof UserError) return { error: err.message };
  return toActionError(err);
}

function refresh() {
  revalidatePath("/", "layout");
}

export async function createWorkItem(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAuth();
  try {
    const data = createSchema.parse(Object.fromEntries(formData.entries()));
    await db.$transaction(async (tx) => {
      let lobId = data.lobId;
      let parentType: WorkItemType | null = null;
      let parentSprintId: string | null = null;
      if (data.parentId) {
        const parent = await tx.workItem.findUnique({ where: { id: data.parentId }, select: { type: true, lobId: true, sprintId: true } });
        if (!parent) throw new UserError("The chosen parent no longer exists.");
        parentType = parent.type;
        lobId = parent.lobId;
        parentSprintId = parent.sprintId;
      }
      const parentError = validateParent(data.type, parentType);
      if (parentError) throw new UserError(parentError);
      if (!lobId) throw new UserError("Please choose a line of business.");

      const isTask = data.type === "TASK";
      await assertAssignee(tx, isTask ? data.assigneeId : null, lobId);

      const lob = await tx.lineOfBusiness.update({
        where: { id: lobId },
        data: { nextItemNumber: { increment: 1 } },
        select: { nextItemNumber: true },
      });
      const siblings = await tx.workItem.findMany({
        where: { lobId, parentId: data.parentId ?? null },
        select: { rank: true },
      });
      const item = await tx.workItem.create({
        data: {
          type: data.type,
          number: lob.nextItemNumber - 1,
          title: data.title,
          priority: data.priority as "HIGH" | "MEDIUM" | "LOW",
          lobId,
          parentId: data.parentId,
          assigneeId: isTask ? data.assigneeId : null,
          estimateHours: isTask ? data.estimateHours : null,
          sprintId: isTask ? parentSprintId : null,
          rank: nextRank(siblings.map((s) => s.rank)),
        },
      });
      await tx.workItemHistory.create({ data: { workItemId: item.id, field: "created", newValue: data.type } });
      if (isTask && parentSprintId) {
        await tx.workItemHistory.create({ data: { workItemId: item.id, field: "sprint", newValue: parentSprintId } });
      }
    });
  } catch (err) {
    return fail(err);
  }
  refresh();
  return { ok: true };
}

const updateSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1, "Title is required").max(200, "Title is too long"),
  description: z.string().max(10000, "Description is too long").default(""),
  acceptanceCriteria: z.string().max(10000, "Acceptance criteria are too long").default(""),
  priority: z.enum(PRIORITIES as [string, ...string[]]),
  status: z.string().optional(),
  parentId: optionalId,
  assigneeId: optionalId,
  estimateHours: hours,
  blocked: z.preprocess((v) => v === "on", z.boolean()),
  blockedReason: z.string().trim().max(500, "Blocked reason is too long").default(""),
});

type Change = { field: string; oldValue: string | null; newValue: string | null };

export async function updateWorkItem(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAuth();
  try {
    const data = updateSchema.parse(Object.fromEntries(formData.entries()));
    await db.$transaction(async (tx) => {
      const item = await tx.workItem.findUnique({ where: { id: data.id } });
      if (!item) throw new UserError("This item no longer exists.");
      const isTask = item.type === "TASK";

      // Parent: may move within the same line of business only.
      let parentId = item.parentId;
      let sprintId = item.sprintId;
      if (PARENT_TYPES[item.type].length > 0 && data.parentId !== item.parentId) {
        let parentType: WorkItemType | null = null;
        if (data.parentId) {
          if (data.parentId === item.id) throw new UserError("An item cannot be its own parent.");
          const parent = await tx.workItem.findUnique({ where: { id: data.parentId }, select: { type: true, lobId: true, sprintId: true } });
          if (!parent) throw new UserError("The chosen parent no longer exists.");
          if (parent.lobId !== item.lobId) throw new UserError("The parent must be in the same line of business.");
          parentType = parent.type;
          // An open task follows its new story into that story's sprint.
          if (item.type === "TASK" && item.status !== "DONE") sprintId = parent.sprintId;
        }
        const parentError = validateParent(item.type, parentType);
        if (parentError) throw new UserError(parentError);
        parentId = data.parentId;
      }

      const allowed = statusesFor(item.type);
      const status = (data.status && allowed.includes(data.status as WorkItemStatus) ? data.status : item.status) as WorkItemStatus;
      const assigneeId = isTask ? data.assigneeId : null;
      if (assigneeId !== item.assigneeId) await assertAssignee(tx, assigneeId, item.lobId);
      const estimateHours = isTask ? data.estimateHours : null;
      const blockedReason = data.blocked ? data.blockedReason : "";

      const changes: Change[] = [];
      const track = (field: string, a: unknown, b: unknown) => {
        const oldValue = a == null || a === "" ? null : String(a);
        const newValue = b == null || b === "" ? null : String(b);
        if (oldValue !== newValue) changes.push({ field, oldValue, newValue });
      };
      track("title", item.title, data.title);
      track("status", item.status, status);
      track("priority", item.priority, data.priority);
      track("assignee", item.assigneeId, assigneeId);
      track("estimate", item.estimateHours, estimateHours);
      track("blocked", item.blocked ? item.blockedReason || "yes" : null, data.blocked ? blockedReason || "yes" : null);
      track("parent", item.parentId, parentId);
      track("sprint", item.sprintId, sprintId);

      let rank = item.rank;
      if (parentId !== item.parentId) {
        const siblings = await tx.workItem.findMany({ where: { lobId: item.lobId, parentId }, select: { rank: true } });
        rank = nextRank(siblings.map((s) => s.rank));
      }

      await tx.workItem.update({
        where: { id: item.id },
        data: {
          title: data.title,
          description: data.description,
          acceptanceCriteria: data.acceptanceCriteria,
          priority: data.priority as "HIGH" | "MEDIUM" | "LOW",
          status,
          parentId,
          sprintId,
          rank,
          assigneeId,
          estimateHours,
          blocked: data.blocked,
          blockedReason,
          doneAt: status === "DONE" ? (item.status === "DONE" ? item.doneAt : new Date()) : null,
        },
      });
      if (changes.length) {
        await tx.workItemHistory.createMany({ data: changes.map((c) => ({ workItemId: item.id, ...c })) });
      }
    });
  } catch (err) {
    return fail(err);
  }
  refresh();
  return { ok: true };
}

/** Quick status change from lists and boards. */
export async function setWorkItemStatus(id: string, status: WorkItemStatus): Promise<ActionState> {
  await requireAuth();
  try {
    const item = await db.workItem.findUnique({ where: { id } });
    if (!item) return { error: "This item no longer exists." };
    if (!statusesFor(item.type).includes(status)) {
      return { error: `${TYPE_LABEL[item.type]} cannot have that status.` };
    }
    if (item.status === status) return { ok: true };
    await db.$transaction([
      db.workItem.update({
        where: { id },
        data: { status, doneAt: status === "DONE" ? new Date() : null },
      }),
      db.workItemHistory.create({ data: { workItemId: id, field: "status", oldValue: item.status, newValue: status } }),
    ]);
  } catch (err) {
    return fail(err);
  }
  refresh();
  return { ok: true };
}

/** Save a new order for items that share the same parent (or are top level in the same LOB). */
export async function reorderWorkItems(orderedIds: string[]): Promise<ActionState> {
  await requireAuth();
  try {
    const ids = z.array(z.string().min(1)).min(1).max(1000).parse(orderedIds);
    const items = await db.workItem.findMany({ where: { id: { in: ids } }, select: { id: true, parentId: true, lobId: true } });
    if (items.length !== ids.length) return { error: "Some items no longer exist. Please reload the page." };
    const first = items[0];
    if (!items.every((i) => i.parentId === first.parentId && i.lobId === first.lobId)) {
      return { error: "Items can only be re-ordered within the same parent." };
    }
    await db.$transaction(ids.map((id, index) => db.workItem.update({ where: { id }, data: { rank: index + 1 } })));
  } catch (err) {
    return fail(err);
  }
  refresh();
  return { ok: true };
}

export async function deleteWorkItem(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAuth();
  const id = String(formData.get("id"));
  let backTo = "/backlog";
  try {
    const item = await db.workItem.findUnique({ where: { id }, include: { _count: { select: { children: true } } } });
    if (!item) return { error: "This item no longer exists." };
    if (item._count.children > 0) {
      return { error: `Cannot delete: this item has ${item._count.children} child item(s). Delete or move them first.` };
    }
    if (item.parentId) backTo = `/items/${item.parentId}`;
    await db.workItem.delete({ where: { id } });
  } catch (err) {
    return fail(err);
  }
  refresh();
  redirect(backTo);
}

/**
 * Delete the selected backlog items. An item with children is only deleted when all of its children are selected too
 * (select a parent and its whole tree, or just the leaves). Anything else is kept and listed.
 */
export async function deleteWorkItems(ids: string[]): Promise<ActionState> {
  await requireAuth();
  try {
    const wanted = z.array(z.string().min(1)).max(3000).parse(ids);
    if (wanted.length === 0) return { error: "Tick at least one item first." };
    const items = await db.workItem.findMany({
      where: { id: { in: wanted } },
      select: { id: true, number: true, title: true, lob: { select: { key: true } }, children: { select: { id: true } } },
    });
    // Keep only items whose children are all going too.
    const going = new Set(items.map((i) => i.id));
    for (let changed = true; changed; ) {
      changed = false;
      for (const i of items) {
        if (going.has(i.id) && i.children.some((c) => !going.has(c.id))) {
          going.delete(i.id);
          changed = true;
        }
      }
    }
    await db.$transaction(async (tx) => {
      // Children before parents, one level at a time.
      let remaining = new Set(going);
      while (remaining.size > 0) {
        const leaves = items.filter((i) => remaining.has(i.id) && i.children.every((c) => !remaining.has(c.id))).map((i) => i.id);
        if (leaves.length === 0) break;
        await tx.workItem.deleteMany({ where: { id: { in: leaves } } });
        remaining = new Set([...remaining].filter((id) => !leaves.includes(id)));
      }
    });
    const kept = items.filter((i) => !going.has(i.id));
    refresh();
    const deleted = going.size;
    return {
      ok: deleted > 0,
      message: deleted > 0 ? `Deleted ${deleted} item${deleted === 1 ? "" : "s"}.` : undefined,
      error: deleted === 0 ? "Nothing was deleted: the selected items have children that were not selected." : undefined,
      details: kept.length ? kept.map((i) => `${itemKey(i.lob.key, i.number)} ${i.title} was kept: it has children that were not selected.`) : undefined,
    };
  } catch (err) {
    return fail(err);
  }
}
