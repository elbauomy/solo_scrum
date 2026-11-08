// Excel import: template and validation. Pure logic, no database access.
import type { Priority, WorkItemType } from "@/lib/enums";
import type { Sheet } from "./excel";
import { LOB_KEY_PATTERN, PARENT_TYPES, TYPES, TYPE_LABEL, validateParent } from "./work-items";

export const IMPORT_COLUMNS = ["Type", "LOB Code", "Title", "Parent", "Priority", "Assignee", "Estimate (h)", "Description"] as const;

export function importTemplateSheets(): Sheet[] {
  const col = (label: string, key: string, numeric = false) => ({ key, label, numeric });
  const columns = [
    col("Type", "type"), col("LOB Code", "lob"), col("Title", "title"), col("Parent", "parent"), col("Priority", "priority"),
    col("Assignee", "assignee"), col("Estimate (h)", "estimate", true), col("Description", "description"),
  ];
  return [
    {
      title: "Items",
      columns,
      rows: [
        { type: "Epic", lob: "RB", title: "Online onboarding", parent: "", priority: "High", assignee: "", estimate: null, description: "Example row: delete these examples before importing" },
        { type: "Feature", lob: "RB", title: "KYC check", parent: "Online onboarding", priority: "Medium", assignee: "", estimate: null, description: "" },
        { type: "User Story", lob: "RB", title: "Upload ID document", parent: "KYC check", priority: "Medium", assignee: "", estimate: null, description: "As a customer I can upload my ID" },
        { type: "Task", lob: "RB", title: "Build upload API", parent: "Upload ID document", priority: "Medium", assignee: "Sara Ali", estimate: 6, description: "" },
        { type: "Bug", lob: "RB", title: "Login button misaligned", parent: "", priority: "Low", assignee: "", estimate: null, description: "" },
        { type: "Task", lob: "RB", title: "Fix CSS", parent: "Login button misaligned", priority: "Low", assignee: "", estimate: 1.5, description: "" },
      ],
    },
    {
      title: "How to fill",
      columns: [col("Column", "c"), col("Rules", "r")],
      rows: [
        { c: "Type", r: "Epic, Feature, User Story (or Story), Bug or Task." },
        { c: "LOB Code", r: "The code of an existing line of business, e.g. RB." },
        { c: "Title", r: "Required, up to 200 characters." },
        { c: "Parent", r: "Required for Feature (an Epic) and Task (a Story or Bug). Optional for a Story or Bug (a Feature). Write the parent's title from an earlier row, or an existing ID such as RB-12. Leave empty for Epics." },
        { c: "Priority", r: "High, Medium or Low. Empty means Medium." },
        { c: "Assignee", r: "Tasks only. The exact name of a member of the squad that owns the line of business." },
        { c: "Estimate (h)", r: "Tasks only. Hours, e.g. 6 or 1.5." },
        { c: "Description", r: "Optional text." },
        { c: "Order", r: "Put a parent above its children. Nothing is imported if any row has an error." },
      ],
    },
  ];
}

export type ImportContext = {
  lobsByKey: Map<string, { id: string; squadId: string }>;
  membersByName: Map<string, { id: string; squadIds: Set<string> }[]>;
  existingByKey: Map<string, { id: string; type: WorkItemType; lobId: string }>;
  existingByTitle: Map<string, { id: string; type: WorkItemType }[]>;
};

export type PlannedItem = {
  row: number;
  type: WorkItemType;
  lobId: string;
  title: string;
  /** Existing item id, or index (into the planned list) of an earlier row */
  parent: { existingId: string } | { index: number } | null;
  priority: Priority;
  assigneeId: string | null;
  estimate: number | null;
  description: string;
};

export type ImportPlan = { items: PlannedItem[]; errors: { row: number; message: string }[] };

const TYPE_ALIASES: Record<string, WorkItemType> = { epic: "EPIC", feature: "FEATURE", story: "STORY", "user story": "STORY", userstory: "STORY", bug: "BUG", task: "TASK" };
const PRIORITY_ALIASES: Record<string, Priority> = { high: "HIGH", medium: "MEDIUM", med: "MEDIUM", low: "LOW", "": "MEDIUM" };

const get = (r: Record<string, string>, ...names: string[]) => {
  for (const n of names) {
    const hit = Object.keys(r).find((k) => k.toLowerCase() === n.toLowerCase());
    if (hit) return (r[hit] ?? "").trim();
  }
  return "";
};

export function planImport(rows: Record<string, string>[], ctx: ImportContext): ImportPlan {
  const items: PlannedItem[] = [];
  const errors: ImportPlan["errors"] = [];
  const byTitle = new Map<string, number[]>(); // `${lobId}|${title}` -> indexes of earlier planned rows

  rows.forEach((r, i) => {
    const row = i + 2; // spreadsheet row number (row 1 is the header)
    const fail = (message: string) => errors.push({ row, message });
    const type = TYPE_ALIASES[get(r, "Type").toLowerCase()];
    if (!type) return fail(`Type must be one of: ${TYPES.map((t) => TYPE_LABEL[t]).join(", ")}.`);
    const lobCode = get(r, "LOB Code", "LOB").toUpperCase();
    if (!LOB_KEY_PATTERN.test(lobCode)) return fail("LOB Code is missing or not a valid code.");
    const lob = ctx.lobsByKey.get(lobCode);
    if (!lob) return fail(`There is no line of business with code ${lobCode}.`);
    const title = get(r, "Title");
    if (!title) return fail("Title is required.");
    if (title.length > 200) return fail("Title is longer than 200 characters.");
    const priority = PRIORITY_ALIASES[get(r, "Priority").toLowerCase()];
    if (!priority) return fail("Priority must be High, Medium or Low.");

    // Parent
    const parentText = get(r, "Parent");
    let parent: PlannedItem["parent"] = null;
    let parentType: WorkItemType | null = null;
    if (parentText) {
      if (PARENT_TYPES[type].length === 0) return fail(`${TYPE_LABEL[type]} items cannot have a parent.`);
      const asKey = parentText.toUpperCase();
      const existing = ctx.existingByKey.get(asKey);
      if (existing) {
        if (existing.lobId !== lob.id) return fail(`${asKey} belongs to a different line of business.`);
        parent = { existingId: existing.id };
        parentType = existing.type;
      } else {
        const k = `${lob.id}|${parentText.toLowerCase()}`;
        const fromFile = (byTitle.get(k) ?? []).filter((idx) => PARENT_TYPES[type].includes(items[idx].type));
        const fromDb = (ctx.existingByTitle.get(k) ?? []).filter((x) => PARENT_TYPES[type].includes(x.type));
        if (fromFile.length + fromDb.length > 1) return fail(`"${parentText}" matches more than one possible parent. Use the item ID (e.g. ${lobCode}-12) instead.`);
        if (fromFile.length === 1) {
          parent = { index: fromFile[0] };
          parentType = items[fromFile[0]].type;
        } else if (fromDb.length === 1) {
          parent = { existingId: fromDb[0].id };
          parentType = fromDb[0].type;
        } else return fail(`Parent "${parentText}" was not found. Put it in an earlier row or use an existing item ID.`);
      }
    }
    const parentError = validateParent(type, parentType);
    if (parentError) return fail(parentError);

    // Task fields
    let assigneeId: string | null = null;
    let estimate: number | null = null;
    const assignee = get(r, "Assignee");
    const estimateText = get(r, "Estimate (h)", "Estimate", "Hours");
    if (type === "TASK") {
      if (assignee) {
        const matches = ctx.membersByName.get(assignee.toLowerCase()) ?? [];
        const inSquad = matches.filter((m) => m.squadIds.has(lob.squadId));
        if (matches.length === 0) return fail(`There is no member named "${assignee}".`);
        if (inSquad.length === 0) return fail(`${assignee} is not a member of the squad that owns ${lobCode}.`);
        if (inSquad.length > 1) return fail(`More than one member is named "${assignee}".`);
        assigneeId = inSquad[0].id;
      }
      if (estimateText) {
        const n = Number(estimateText.replace(",", "."));
        if (!Number.isFinite(n) || n < 0 || n > 1000) return fail("Estimate must be a number between 0 and 1000.");
        estimate = n;
      }
    } else if (assignee || estimateText) {
      return fail("Assignee and Estimate can only be set on tasks.");
    }

    items.push({ row, type, lobId: lob.id, title, parent, priority, assigneeId, estimate, description: get(r, "Description") });
    const k = `${lob.id}|${title.toLowerCase()}`;
    byTitle.set(k, [...(byTitle.get(k) ?? []), items.length - 1]);
  });

  return { items, errors };
}
