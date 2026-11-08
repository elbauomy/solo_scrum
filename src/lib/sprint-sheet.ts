// Sprint planning sheet: reading the grid and planning the import. Pure logic, no database access.
//
// The sheet layout (one tab, e.g. "Sprint 62"):
//   row 1      title ("Sonata - Release 6 - Sprint 62"), From / To dates, "10 Days"
//   header row "Team Member" then one column per member ("Dev (1)<newline>Anna")
//   capacity   availability %, Initial buffer hours, meetings, vacations (days), excuses, done-definition and special tasks, Final Buffer
//   stories    a numbered row with the story title, then one row per task type with hours in the member's column
import type { SprintState } from "@/lib/enums";

export type Grid = string[][];

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** Parse CSV text (quoted fields, doubled quotes, line breaks inside quotes). */
export function parseCsv(input: string): Grid {
  const text = input.replace(/^﻿/, "");
  const rows: Grid = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

export const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const clean = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const cellAt = (row: string[] | undefined, col: number) => (row && col >= 0 ? (row[col] ?? "") : "");

/** "63.00", "7", "1,5", "100%" -> number; text like "#REF!" -> null. */
export function parseNumber(raw: string): number | null {
  const s = raw.trim().replace(/,/g, ".");
  if (!s) return null;
  const m = /^(-?\d+(?:\.\d+)?)\s*%?$/.exec(s);
  return m ? Number(m[1]) : null;
}

const pad = (n: number) => String(n).padStart(2, "0");
const validISO = (y: number, m: number, d: number): string | null => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * Read one date. "2026-11-01", "11/1/2026" (month first, as in the ACT sheet), "1/11/2026" (day first when the
 * first number is above 12) and "1 Nov 2026". Returns every reading that is a real date, preferred reading first.
 */
export function dateCandidates(raw: string, hint: "mdy" | "dmy" | null = null): string[] {
  const s = raw.trim();
  if (!s) return [];
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return [validISO(+m[1], +m[2], +m[3])].filter((x): x is string => !!x);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s);
  if (m) {
    const a = +m[1];
    const b = +m[2];
    const y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    const monthFirst = validISO(y, a, b);
    const dayFirst = validISO(y, b, a);
    const ordered = a > 12 ? [dayFirst] : b > 12 ? [monthFirst] : hint === "dmy" ? [dayFirst, monthFirst] : [monthFirst, dayFirst];
    return [...new Set(ordered.filter((x): x is string => !!x))];
  }
  m = /^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?,?\s+(\d{4})$/.exec(s);
  if (m) {
    const mi = MONTHS.indexOf(m[2].toLowerCase());
    const iso = mi >= 0 ? validISO(+m[3], mi + 1, +m[1]) : null;
    return iso ? [iso] : [];
  }
  return [];
}

/** If a date like 25/12/2026 or 12/25/2026 shows which number is the day, the other dates in the sheet follow the same order. */
function orderHint(raw: string): "mdy" | "dmy" | null {
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-]\d{2,4}$/.exec(raw.trim());
  if (!m) return null;
  return +m[1] > 12 ? "dmy" : +m[2] > 12 ? "mdy" : null;
}

/** Choose the readings of From and To that make a sensible range (To not before From). */
export function pickDateRange(fromRaw: string, toRaw: string, days: number | null): { from: string; to: string } | null {
  const hint = orderHint(fromRaw) ?? orderHint(toRaw);
  const froms = dateCandidates(fromRaw, hint);
  const tos = dateCandidates(toRaw, hint);
  const pairs: { from: string; to: string }[] = [];
  for (const f of froms) for (const t of tos) if (t >= f) pairs.push({ from: f, to: t });
  if (pairs.length === 0) return null;
  // Prefer the reading whose length best matches "N Days" (working days are fewer than calendar days, so allow a range).
  if (days && pairs.length > 1) {
    const span = (p: { from: string; to: string }) => Math.round((Date.parse(p.to) - Date.parse(p.from)) / 86400000) + 1;
    const fits = pairs.filter((p) => span(p) >= days && span(p) <= days * 2);
    if (fits.length > 0) return fits[0];
  }
  return pairs[0];
}

// ---------------------------------------------------------------------------
// Parsing the sheet
// ---------------------------------------------------------------------------

export type SheetMember = { col: number; header: string; name: string; role: string };

export type SheetCapacity = {
  availabilityPct: number;
  initialHours: number;
  meetingsHours: number;
  vacationDays: number;
  excuseHours: number;
  otherHours: number;
  /** The sheet's own "Final Buffer" when it holds a number */
  sheetFinal: number | null;
};

export type SheetTask = { row: number; taskType: string; col: number; hours: number };

export type SheetStory = {
  row: number;
  number: string;
  title: string;
  /** Values from the columns to the right of the members (for example "Branch") */
  attributes: Record<string, string>;
  tasks: SheetTask[];
};

export type ParsedSheet = {
  title: string;
  lobText: string;
  releaseText: string;
  sprintName: string;
  from: string | null;
  to: string | null;
  days: number | null;
  members: SheetMember[];
  capacity: Record<number, SheetCapacity>;
  stories: SheetStory[];
  errors: string[];
  warnings: string[];
};

/** Is this grid a sprint planning sheet? (It has a "Team Member" header cell.) */
export function looksLikePlanningSheet(grid: Grid): boolean {
  return grid.some((r) => r.some((c) => norm(c) === "team member"));
}

export function splitMemberHeader(raw: string): { role: string; name: string } {
  const lines = raw.split(/\r?\n/).map(clean).filter(Boolean);
  if (lines.length >= 2) return { role: lines[0], name: lines.slice(1).join(" ") };
  const single = lines[0] ?? "";
  const m = /^((?:Dev|QC|QA|BA|UI|UX|PM|SM)\s*(?:\(\d+\))?)\s+(\S.*)$/i.exec(single);
  return m ? { role: clean(m[1]), name: clean(m[2]) } : { role: "", name: single };
}

export function parseSprintSheet(grid: Grid): ParsedSheet {
  const out: ParsedSheet = { title: "", lobText: "", releaseText: "", sprintName: "", from: null, to: null, days: null, members: [], capacity: {}, stories: [], errors: [], warnings: [] };

  // ---- title row: ... title, From, <date>, To, <date>, "10 Days"
  const titleRowIdx = grid.findIndex((r) => r.some((c) => norm(c) === "from") && r.some((c) => norm(c) === "to"));
  if (titleRowIdx < 0) {
    out.errors.push("Could not find the title row with the sprint name and the From / To dates.");
  } else {
    const r = grid[titleRowIdx];
    const fromCol = r.findIndex((c) => norm(c) === "from");
    const toCol = r.findIndex((c) => norm(c) === "to");
    const titleCell = r.slice(0, fromCol).map(clean).filter(Boolean).pop() ?? "";
    out.title = titleCell;
    const firstAfter = (col: number) => r.slice(col + 1).map((c) => c.trim()).find(Boolean) ?? "";
    const dm = r.map((c) => /(\d+)\s*days?/i.exec(c)).find(Boolean);
    out.days = dm ? Number(dm[1]) : null;
    const range = pickDateRange(firstAfter(fromCol), firstAfter(toCol), out.days);
    if (range) {
      out.from = range.from;
      out.to = range.to;
    } else out.errors.push(`The From / To dates could not be read ("${firstAfter(fromCol)}" – "${firstAfter(toCol)}").`);
    const parts = titleCell.split(/\s+-\s+/).map(clean).filter(Boolean);
    out.sprintName = parts.length ? parts[parts.length - 1] : "";
    if (parts.length >= 3) {
      out.lobText = parts[0];
      out.releaseText = parts.slice(1, -1).join(" - ");
    } else if (parts.length === 2) out.lobText = parts[0];
    if (!out.sprintName) out.errors.push("The sprint title is empty.");
  }

  // ---- member header row
  const hdrIdx = grid.findIndex((r) => r.some((c) => norm(c) === "team member"));
  if (hdrIdx < 0) {
    out.errors.push('Could not find the "Team Member" header row.');
    return out;
  }
  const hdr = grid[hdrIdx];
  const labelCol = hdr.findIndex((c) => norm(c) === "team member");
  const groupCol = labelCol - 1;
  let last = labelCol;
  for (let c = labelCol + 1; c < hdr.length && clean(hdr[c]); c++) {
    const { role, name } = splitMemberHeader(hdr[c]);
    if (name) out.members.push({ col: c, header: clean(hdr[c].replace(/\r?\n/g, " ")), name, role });
    last = c;
  }
  if (out.members.length === 0) out.errors.push("No team member columns were found next to the Team Member heading.");
  const attributeCols: { col: number; label: string }[] = [];
  const seenLabels = new Set<string>();
  for (let c = last + 1; c < hdr.length; c++) {
    const label = clean(hdr[c]);
    if (label && !seenLabels.has(norm(label))) {
      seenLabels.add(norm(label));
      attributeCols.push({ col: c, label });
    }
  }

  // ---- first story row = first row whose group column is a whole number
  const isStoryRow = (r: string[]) => /^\d+$/.test(clean(cellAt(r, groupCol)));
  let firstStory = grid.findIndex((r, i) => i > hdrIdx && isStoryRow(r));
  if (firstStory < 0) firstStory = grid.length;

  // ---- capacity block between the header and the first story
  const memberCols = out.members.map((m) => m.col);
  const numbers = (r: string[]) => memberCols.map((c) => parseNumber(cellAt(r, c)));
  const caps: Record<number, SheetCapacity> = {};
  for (const m of out.members) caps[m.col] = { availabilityPct: 100, initialHours: 0, meetingsHours: 0, vacationDays: 0, excuseHours: 0, otherHours: 0, sheetFinal: null };

  let initialRow = -1;
  let finalRow = -1;
  for (let i = hdrIdx + 1; i < firstStory; i++) {
    const label = `${clean(cellAt(grid[i], groupCol))} ${clean(cellAt(grid[i], labelCol))}`;
    if (/initial\s+buffer/i.test(label) && initialRow < 0) initialRow = i;
    if (/final\s+buffer/i.test(label)) finalRow = i;
  }
  // availability %: the row between the header and Initial buffer that holds percentages
  for (let i = hdrIdx + 1; i < (initialRow < 0 ? firstStory : initialRow); i++) {
    const raw = memberCols.map((c) => cellAt(grid[i], c).trim());
    const withPct = raw.filter((v) => /^\d+(\.\d+)?\s*%$/.test(v) || (/^(0(\.\d+)?|1(\.0+)?)$/.test(v) && v !== "0"));
    if (withPct.length >= Math.ceil(memberCols.length / 2)) {
      out.members.forEach((m, k) => {
        const v = parseNumber(raw[k]);
        if (v != null) caps[m.col].availabilityPct = /%/.test(raw[k]) ? v : v <= 1 ? v * 100 : v;
      });
      break;
    }
  }
  if (initialRow < 0) {
    out.errors.push('Could not find the "Initial buffer hours" row.');
  } else {
    numbers(grid[initialRow]).forEach((v, k) => (caps[out.members[k].col].initialHours = v ?? 0));
    const stop = finalRow > initialRow ? finalRow : firstStory;
    for (let i = initialRow + 1; i < stop; i++) {
      const label = clean(cellAt(grid[i], labelCol)) || clean(cellAt(grid[i], groupCol));
      if (!label) continue;
      const vals = numbers(grid[i]);
      const bad = memberCols.filter((c, k) => cellAt(grid[i], c).trim() !== "" && vals[k] == null);
      if (bad.length) out.warnings.push(`Row ${i + 1} (${label}) has values that are not numbers; they were counted as 0.`);
      vals.forEach((v, k) => {
        const cap = caps[out.members[k].col];
        const n = v ?? 0;
        if (/vacation/i.test(label)) cap.vacationDays += n;
        else if (/excuse/i.test(label)) cap.excuseHours += n;
        else if (/^\(-\)/.test(label) || /meeting|planning|retro|standup|review/i.test(label)) cap.meetingsHours += n;
        else cap.otherHours += n;
      });
    }
  }
  if (finalRow >= 0) numbers(grid[finalRow]).forEach((v, k) => (caps[out.members[k].col].sheetFinal = v));
  out.capacity = caps;

  // ---- stories
  let cur: SheetStory | null = null;
  for (let i = firstStory; i < grid.length; i++) {
    const r = grid[i];
    if (isStoryRow(r)) {
      const attributes: Record<string, string> = {};
      for (const a of attributeCols) {
        const v = clean(cellAt(r, a.col));
        if (v) attributes[a.label] = v;
      }
      cur = { row: i + 1, number: clean(cellAt(r, groupCol)), title: clean(cellAt(r, labelCol)), attributes, tasks: [] };
      out.stories.push(cur);
      continue;
    }
    if (!cur) continue;
    const taskType = clean(cellAt(r, labelCol));
    if (!taskType) continue;
    for (const m of out.members) {
      const raw = cellAt(r, m.col).trim();
      if (!raw) continue;
      const hours = parseNumber(raw);
      if (hours == null) out.warnings.push(`Row ${i + 1}: "${raw}" under ${m.name} is not a number of hours and was ignored.`);
      else if (hours > 0) cur.tasks.push({ row: i + 1, taskType, col: m.col, hours });
    }
  }
  if (out.stories.length === 0) out.errors.push("No story rows were found. Each story starts with a number in the first column.");
  return out;
}

// ---------------------------------------------------------------------------
// Planning the import
// ---------------------------------------------------------------------------

export type PlanLob = { id: string; name: string; key: string; squadId: string; squadName: string };
export type PlanMember = { id: string; name: string; role: string; active: boolean; squadIds: string[] };
export type PlanItem = {
  id: string;
  type: "STORY" | "BUG" | "TASK";
  title: string;
  status: string;
  sprintId: string | null;
  parentId: string | null;
  assigneeId: string | null;
  estimateHours: number | null;
  rank: number;
};

export type PlanContext = {
  lobs: PlanLob[];
  /** LOB chosen in the form; wins over the sheet title */
  lobOverrideId?: string;
  members: PlanMember[];
  releases: { id: string; lobId: string; name: string }[];
  sprints: { id: string; lobId: string; name: string; state: SprintState; releaseId: string | null }[];
  /** Stories, bugs and tasks of the chosen line of business */
  items: PlanItem[];
  workingDaysPerWeek: number;
  /** Working days between From and To according to Settings */
  calendarDays: number;
};

export type MemberRef = { existingId: string } | { newIndex: number };
type ItemRef = { existingId: string } | { newIndex: number };

export type ImportOps = {
  lobId: string;
  squadId: string;
  sprint: { existingId: string | null; name: string; startDate: string; endDate: string; releaseId: string | null };
  newMembers: { name: string; role: string }[];
  /** Members to add to the squad (existing or new), with their weekly hours there */
  memberships: { member: MemberRef; weeklyHours: number }[];
  plans: { member: MemberRef; availabilityPct: number; initialHours: number; meetingsHours: number; vacationHours: number; excuseHours: number; otherHours: number; capacityHours: number }[];
  newStories: { title: string; description: string }[];
  /** Existing stories to plan into the sprint */
  moveStories: { id: string }[];
  newTasks: { story: ItemRef; title: string; member: MemberRef; hours: number }[];
  updateTasks: { id: string; hours: number; oldHours: number | null }[];
};

export type PreviewMember = {
  header: string;
  name: string;
  role: string;
  status: "matched" | "added-to-squad" | "new" | "ambiguous";
  capacity: number;
  initialHours: number;
  meetingsHours: number;
  vacationHours: number;
  otherHours: number;
  assigned: number;
  remaining: number;
};
export type PreviewStory = {
  number: string;
  title: string;
  isNew: boolean;
  hours: number;
  note: string;
  tasks: { type: string; member: string; hours: number; action: "new" | "update" | "same" }[];
};
export type SprintImportPreview = {
  sprint: { name: string; lobName: string; lobKey: string; squadName: string; from: string; to: string; days: number | null; calendarDays: number; exists: boolean; releaseName: string | null };
  members: PreviewMember[];
  stories: PreviewStory[];
  skipped: string[];
  totals: { stories: number; newStories: number; tasks: number; newTasks: number; updatedTasks: number; hours: number; newMembers: number; addedToSquad: number };
  warnings: string[];
  errors: string[];
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export function resolveLob(parsed: ParsedSheet, lobs: PlanLob[], overrideId?: string): { lob: PlanLob | null; error?: string } {
  if (overrideId) {
    const l = lobs.find((x) => x.id === overrideId);
    return l ? { lob: l } : { lob: null, error: "The chosen line of business no longer exists." };
  }
  const t = norm(parsed.lobText);
  if (!t) return { lob: null, error: "The sheet title does not name a line of business. Choose one in the form." };
  const exact = lobs.filter((l) => norm(l.name) === t || norm(l.key) === t);
  if (exact.length === 1) return { lob: exact[0] };
  const loose = lobs.filter((l) => norm(l.name).startsWith(t) || t.startsWith(norm(l.name)));
  if (loose.length === 1) return { lob: loose[0] };
  return { lob: null, error: `No single line of business matches "${parsed.lobText}". Choose one in the form.` };
}

export function planSprintImport(parsed: ParsedSheet, ctx: PlanContext): { preview: SprintImportPreview | null; ops: ImportOps | null; errors: string[]; warnings: string[] } {
  const errors = [...parsed.errors];
  const warnings = [...parsed.warnings];
  const { lob, error: lobError } = resolveLob(parsed, ctx.lobs, ctx.lobOverrideId);
  if (lobError) errors.push(lobError);
  if (!lob || !parsed.from || !parsed.to || errors.length > 0) return { preview: null, ops: null, errors, warnings };

  // ---- sprint
  const sprint = ctx.sprints.find((s) => s.lobId === lob.id && norm(s.name) === norm(parsed.sprintName)) ?? null;
  if (sprint?.state === "CLOSED") errors.push(`${parsed.sprintName} is already closed, so it cannot be changed.`);
  let release: { id: string; name: string } | null = null;
  if (parsed.releaseText) {
    const rel = ctx.releases.filter((r) => r.lobId === lob.id && (norm(r.name) === norm(parsed.releaseText) || norm(r.name).includes(norm(parsed.releaseText))));
    if (rel.length >= 1) release = rel.find((r) => norm(r.name) === norm(parsed.releaseText)) ?? rel[0];
    else warnings.push(`Release "${parsed.releaseText}" was not found for ${lob.name}. The sprint is not attached to a release; create it on the Releases page and add the sprint there.`);
  }
  if (parsed.days && ctx.calendarDays !== parsed.days) {
    warnings.push(`The sheet says ${parsed.days} days, but Settings (working days and holidays) give ${ctx.calendarDays} working days between ${parsed.from} and ${parsed.to}. Capacity comes from the sheet either way; check Settings if this is not expected.`);
  }

  // ---- members
  const newMembers: ImportOps["newMembers"] = [];
  const memberRef = new Map<number, MemberRef>();
  const used = new Set<string>();
  const previewMembers: PreviewMember[] = [];
  const memberships: ImportOps["memberships"] = [];
  const plans: ImportOps["plans"] = [];
  const days = parsed.days ?? ctx.calendarDays;
  const assignedByCol = new Map<number, number>();
  for (const s of parsed.stories) for (const t of s.tasks) assignedByCol.set(t.col, (assignedByCol.get(t.col) ?? 0) + t.hours);

  for (const m of parsed.members) {
    const cap = parsed.capacity[m.col];
    const candidates = ctx.members.filter((x) => norm(x.name) === norm(m.name) && !used.has(x.id));
    let match: PlanMember | null = null;
    let ambiguous = false;
    if (candidates.length === 1) match = candidates[0];
    else if (candidates.length > 1) {
      const byRole = candidates.filter((x) => m.role && norm(x.role) === norm(m.role));
      const byKind = candidates.filter((x) => m.role && norm(x.role).split(/[\s(]/)[0] === norm(m.role).split(/[\s(]/)[0]);
      match = byRole.length === 1 ? byRole[0] : byKind.length === 1 ? byKind[0] : null;
      if (!match) {
        ambiguous = true;
        errors.push(`More than one member is named "${m.name}". Give them different roles (for example "${m.role || "Dev (1)"}") on the Members page so the sheet columns can be told apart.`);
      }
    }

    const dayHours = days > 0 && cap.availabilityPct > 0 ? cap.initialHours / (cap.availabilityPct / 100) / days : 7;
    const vacationHours = r2(cap.vacationDays * dayHours);
    const computed = r2(cap.initialHours - cap.meetingsHours - vacationHours - cap.excuseHours - cap.otherHours);
    let capacity = computed;
    if (cap.sheetFinal != null && Math.abs(cap.sheetFinal - computed) > 0.5) {
      warnings.push(`${m.name}: the sheet's Final Buffer (${cap.sheetFinal}h) differs from its own rows (${computed}h). The sheet's value is used.`);
      capacity = cap.sheetFinal;
    } else if (cap.sheetFinal != null) capacity = cap.sheetFinal;
    capacity = Math.max(0, capacity);

    let status: PreviewMember["status"];
    let ref: MemberRef | null = null;
    if (ambiguous) status = "ambiguous";
    else if (match) {
      used.add(match.id);
      ref = { existingId: match.id };
      if (!match.active) warnings.push(`${match.name} is inactive in the system. Reactivate them on the Members page so their tasks are scheduled.`);
      if (match.squadIds.includes(lob.squadId)) status = "matched";
      else {
        status = "added-to-squad";
        memberships.push({ member: ref, weeklyHours: r2((cap.initialHours / Math.max(1, days)) * ctx.workingDaysPerWeek) || 40 });
      }
    } else {
      status = "new";
      ref = { newIndex: newMembers.length };
      newMembers.push({ name: m.name, role: m.role });
      memberships.push({ member: ref, weeklyHours: r2((cap.initialHours / Math.max(1, days)) * ctx.workingDaysPerWeek) || 40 });
    }
    if (ref) {
      memberRef.set(m.col, ref);
      plans.push({
        member: ref,
        availabilityPct: cap.availabilityPct,
        initialHours: cap.initialHours,
        meetingsHours: cap.meetingsHours,
        vacationHours,
        excuseHours: cap.excuseHours,
        otherHours: cap.otherHours,
        capacityHours: capacity,
      });
    }
    const assigned = assignedByCol.get(m.col) ?? 0;
    previewMembers.push({
      header: m.header,
      name: m.name,
      role: m.role,
      status,
      capacity,
      initialHours: cap.initialHours,
      meetingsHours: cap.meetingsHours,
      vacationHours,
      otherHours: r2(cap.otherHours + cap.excuseHours),
      assigned: r2(assigned),
      remaining: r2(capacity - assigned),
    });
    if (assigned > capacity + 0.01) warnings.push(`${m.name} is assigned ${r2(assigned)}h but has only ${capacity}h available (${r2(assigned - capacity)}h over).`);
  }

  // ---- stories and tasks
  const stories = ctx.items.filter((i) => i.type === "STORY" || i.type === "BUG");
  const tasksOf = (id: string) => ctx.items.filter((i) => i.type === "TASK" && i.parentId === id);
  const newStories: ImportOps["newStories"] = [];
  const moveStories: ImportOps["moveStories"] = [];
  const newTasks: ImportOps["newTasks"] = [];
  const updateTasks: ImportOps["updateTasks"] = [];
  const previewStories: PreviewStory[] = [];
  const skipped: string[] = [];
  const seenTitles = new Map<string, ItemRef>();
  const sprintId = sprint?.id ?? null;
  let totalHours = 0;
  let taskCount = 0;

  for (const s of parsed.stories) {
    if (!s.title) {
      if (s.tasks.length > 0) warnings.push(`Row ${s.row}: story ${s.number} has hours but no title, so it was skipped.`);
      continue;
    }
    if (s.tasks.length === 0) {
      skipped.push(s.title);
      continue;
    }
    const key = norm(s.title);
    let ref: ItemRef | null = seenTitles.get(key) ?? null;
    let isNew = false;
    let note = "";
    let existing: PlanItem | null = null;
    if (!ref) {
      const found = stories
        .filter((i) => norm(i.title) === key)
        .sort((a, b) => Number(b.sprintId === sprintId && sprintId != null) - Number(a.sprintId === sprintId && sprintId != null) || Number(a.status === "DONE") - Number(b.status === "DONE"));
      existing = found[0] ?? null;
      if (existing?.status === "DONE") {
        warnings.push(`"${s.title}" already exists and is Done, so it was skipped.`);
        continue;
      }
      if (existing) {
        ref = { existingId: existing.id };
        if (sprintId == null || existing.sprintId !== sprintId) {
          moveStories.push({ id: existing.id });
          note = existing.sprintId ? "moves into this sprint" : "taken from the backlog";
        } else note = "already in this sprint";
      } else {
        ref = { newIndex: newStories.length };
        isNew = true;
        const attrs = Object.entries(s.attributes).map(([k, v]) => `${k}: ${v}`).join("\n");
        newStories.push({ title: s.title, description: attrs });
        note = "new story";
      }
      seenTitles.set(key, ref);
    } else warnings.push(`The story "${s.title}" appears twice in the sheet; its tasks were merged.`);

    const known = existing ? tasksOf(existing.id) : "existingId" in ref ? tasksOf(ref.existingId) : [];
    const pt: PreviewStory["tasks"] = [];
    let sh = 0;
    for (const t of s.tasks) {
      const mref = memberRef.get(t.col);
      if (!mref) continue; // ambiguous member; an error is already recorded
      const memberName = parsed.members.find((m) => m.col === t.col)?.name ?? "";
      const memberId = "existingId" in mref ? mref.existingId : null;
      const match = memberId ? known.find((k) => norm(k.title) === norm(t.taskType) && k.assigneeId === memberId) : null;
      sh += t.hours;
      taskCount += 1;
      if (match) {
        if (match.status === "DONE") {
          warnings.push(`${t.taskType} for "${s.title}" (${memberName}) is already Done, so its hours were left alone.`);
          pt.push({ type: t.taskType, member: memberName, hours: t.hours, action: "same" });
        } else if (match.estimateHours !== t.hours) {
          updateTasks.push({ id: match.id, hours: t.hours, oldHours: match.estimateHours });
          pt.push({ type: t.taskType, member: memberName, hours: t.hours, action: "update" });
        } else pt.push({ type: t.taskType, member: memberName, hours: t.hours, action: "same" });
      } else {
        newTasks.push({ story: ref, title: t.taskType, member: mref, hours: t.hours });
        pt.push({ type: t.taskType, member: memberName, hours: t.hours, action: "new" });
      }
    }
    totalHours += sh;
    previewStories.push({ number: s.number, title: s.title, isNew, hours: r2(sh), note, tasks: pt });
  }
  if (previewStories.length === 0 && errors.length === 0) warnings.push("No story in the sheet has any hours, so there is nothing to import.");

  const preview: SprintImportPreview = {
    sprint: {
      name: parsed.sprintName,
      lobName: lob.name,
      lobKey: lob.key,
      squadName: lob.squadName,
      from: parsed.from,
      to: parsed.to,
      days: parsed.days,
      calendarDays: ctx.calendarDays,
      exists: Boolean(sprint),
      releaseName: release?.name ?? null,
    },
    members: previewMembers,
    stories: previewStories,
    skipped,
    totals: {
      stories: previewStories.length,
      newStories: newStories.length,
      tasks: taskCount,
      newTasks: newTasks.length,
      updatedTasks: updateTasks.length,
      hours: r2(totalHours),
      newMembers: newMembers.length,
      addedToSquad: memberships.length - newMembers.length,
    },
    warnings,
    errors,
  };
  if (errors.length > 0) return { preview, ops: null, errors, warnings };
  return {
    preview,
    errors,
    warnings,
    ops: {
      lobId: lob.id,
      squadId: lob.squadId,
      sprint: { existingId: sprint?.id ?? null, name: parsed.sprintName, startDate: parsed.from, endDate: parsed.to, releaseId: release?.id ?? sprint?.releaseId ?? null },
      newMembers,
      memberships,
      plans,
      newStories,
      moveStories,
      newTasks,
      updateTasks,
    },
  };
}
