"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { readFirstSheet } from "@/lib/excel";
import { IMPORT_COLUMNS, planImport, type ImportContext } from "@/lib/import";
import { type ActionState, toActionError } from "@/lib/action-state";
import { TYPE_LABEL, itemKey, nextRank } from "@/lib/work-items";

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_ROWS = 1000;

/** Check an Excel file (mode "check") or import it (mode "import"). Nothing is imported if any row has an error. */
export async function importItems(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("data.import");
  try {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return { error: "Please choose an Excel (.xlsx) file." };
    if (!file.name.toLowerCase().endsWith(".xlsx")) return { error: "The file must be an Excel .xlsx file." };
    if (file.size > MAX_BYTES) return { error: "The file is larger than 2 MB." };
    const mode = formData.get("mode") === "import" ? "import" : "check";

    let sheet;
    try {
      sheet = await readFirstSheet(await file.arrayBuffer());
    } catch {
      return { error: "This file could not be read. Please use the template." };
    }
    const have = sheet.headers.map((h) => h.toLowerCase());
    const missing = ["Type", "LOB Code", "Title"].filter((h) => !have.includes(h.toLowerCase()));
    if (missing.length) return { error: `The first row must contain these headings: ${IMPORT_COLUMNS.join(", ")}. Missing: ${missing.join(", ")}.` };
    if (sheet.rows.length === 0) return { error: "The file has no rows to import." };
    if (sheet.rows.length > MAX_ROWS) return { error: `Please import at most ${MAX_ROWS} rows at a time.` };

    const [lobs, members, existing] = await Promise.all([
      db.lineOfBusiness.findMany({ select: { id: true, key: true, squadId: true } }),
      db.member.findMany({ where: { active: true }, select: { id: true, name: true, memberships: { select: { squadId: true } } } }),
      db.workItem.findMany({ select: { id: true, type: true, title: true, number: true, lobId: true } }),
    ]);
    const keyOfLob = new Map(lobs.map((l) => [l.id, l.key]));
    const ctx: ImportContext = {
      lobsByKey: new Map(lobs.map((l) => [l.key, { id: l.id, squadId: l.squadId }])),
      membersByName: new Map(),
      existingByKey: new Map(existing.map((i) => [itemKey(keyOfLob.get(i.lobId) ?? "?", i.number), { id: i.id, type: i.type, lobId: i.lobId }])),
      existingByTitle: new Map(),
    };
    for (const m of members) {
      const k = m.name.trim().toLowerCase();
      ctx.membersByName.set(k, [...(ctx.membersByName.get(k) ?? []), { id: m.id, squadIds: new Set(m.memberships.map((x) => x.squadId)) }]);
    }
    for (const i of existing) {
      const k = `${i.lobId}|${i.title.trim().toLowerCase()}`;
      ctx.existingByTitle.set(k, [...(ctx.existingByTitle.get(k) ?? []), { id: i.id, type: i.type }]);
    }

    const plan = planImport(sheet.rows, ctx);
    if (plan.errors.length > 0) {
      return {
        error: `${plan.errors.length} row(s) have problems. Nothing was imported. Fix them and upload the file again.`,
        details: plan.errors.slice(0, 50).map((e) => `Row ${e.row}: ${e.message}`),
      };
    }
    const counts = new Map<string, number>();
    for (const i of plan.items) counts.set(TYPE_LABEL[i.type], (counts.get(TYPE_LABEL[i.type]) ?? 0) + 1);
    const summary = [...counts.entries()].map(([t, n]) => `${n} ${t}${n === 1 ? "" : "s"}`).join(", ");
    if (mode === "check") return { ok: true, message: `The file is valid: ${summary}. Click “Import” to add them.` };

    await db.$transaction(
      async (tx) => {
        const createdIds: string[] = [];
        for (const p of plan.items) {
          const parentId = p.parent ? ("existingId" in p.parent ? p.parent.existingId : createdIds[p.parent.index]) : null;
          const parent = parentId ? await tx.workItem.findUnique({ where: { id: parentId }, select: { sprintId: true } }) : null;
          const lob = await tx.lineOfBusiness.update({ where: { id: p.lobId }, data: { nextItemNumber: { increment: 1 } }, select: { nextItemNumber: true } });
          const siblings = await tx.workItem.findMany({ where: { lobId: p.lobId, parentId }, select: { rank: true } });
          const sprintId = p.type === "TASK" ? parent?.sprintId ?? null : null;
          const created = await tx.workItem.create({
            data: {
              type: p.type, number: lob.nextItemNumber - 1, title: p.title, description: p.description, priority: p.priority, lobId: p.lobId, parentId,
              assigneeId: p.assigneeId, estimateHours: p.estimate, sprintId, rank: nextRank(siblings.map((s) => s.rank)),
            },
          });
          createdIds.push(created.id);
          await tx.workItemHistory.create({ data: { workItemId: created.id, field: "created", newValue: p.type } });
          if (sprintId) await tx.workItemHistory.create({ data: { workItemId: created.id, field: "sprint", newValue: sprintId } });
        }
      },
      { timeout: 60000 },
    );
    revalidatePath("/", "layout");
    return { ok: true, message: `Imported ${summary}.` };
  } catch (err) {
    return toActionError(err);
  }
}
