import type { Tx } from "./db";

export class UserError extends Error {}

/**
 * Put a story or bug in a sprint (or back in the backlog with sprintId = null).
 * Its open tasks follow it; tasks that are already Done stay in the sprint where they were finished.
 * Every change is written to the item history.
 */
export async function moveItemToSprint(tx: Tx, itemId: string, sprintId: string | null): Promise<void> {
  const item = await tx.workItem.findUnique({ where: { id: itemId }, include: { children: { where: { type: "TASK" } } } });
  if (!item) throw new UserError("This item no longer exists.");
  if (item.type !== "STORY" && item.type !== "BUG") throw new UserError("Only user stories and bugs can be planned into a sprint.");
  if (sprintId) {
    const sprint = await tx.sprint.findUnique({ where: { id: sprintId } });
    if (!sprint) throw new UserError("This sprint no longer exists.");
    if (sprint.lobId !== item.lobId) throw new UserError("The sprint belongs to a different line of business.");
    if (sprint.state === "CLOSED") throw new UserError("A closed sprint cannot receive items.");
  }
  const moves = [item, ...item.children.filter((t) => t.status !== "DONE")].filter((i) => i.sprintId !== sprintId);
  for (const m of moves) {
    await tx.workItem.update({ where: { id: m.id }, data: { sprintId } });
    await tx.workItemHistory.create({ data: { workItemId: m.id, field: "sprint", oldValue: m.sprintId, newValue: sprintId } });
  }
}
