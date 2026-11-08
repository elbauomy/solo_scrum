import Link from "next/link";
import { requirePageAccess } from "@/lib/auth";
import { RoleProvider } from "@/components/role-provider";
import { db } from "@/lib/db";
import { loadAnalytics } from "@/lib/analytics";
import { applyCls, selectCls } from "@/lib/filters";
import { STATUS_LABEL, itemKey, statusesFor } from "@/lib/work-items";
import { Board, type BoardCard, type BoardColumn } from "@/components/board";
import { HealthBadge, LoadBar, SprintStateBadge, fmtH } from "@/components/sprint-ui";
import { Card, Empty, PageHeader } from "@/components/ui";

type Q = { squad?: string; lob?: string; sprint?: string; assignee?: string; parentType?: string; scope?: string; blocked?: string; q?: string; level?: string; group?: string };

export default async function BoardPage({ searchParams }: PageProps<"/board">) {
  const me = await requirePageAccess("board.view");
  const f = (await searchParams) as Q;
  const a = await loadAnalytics();
  const level = f.level === "stories" ? "stories" : "tasks";
  const group = level === "tasks" && f.group === "member" ? "member" : "status";

  const choices = a.sprints
    .filter((s) => s.state !== "CLOSED" || s.id === f.sprint)
    .filter((s) => (!f.squad || s.squadId === f.squad) && (!f.lob || s.lobId === f.lob));
  const sprint =
    a.sprints.find((s) => s.id === f.sprint) ??
    choices.find((s) => s.state === "ACTIVE") ??
    choices[0];

  const header = (
    <Card className="mb-4">
      <form className="flex flex-wrap items-end gap-2">
        <select name="squad" defaultValue={f.squad ?? ""} className={selectCls} aria-label="Squad">
          <option value="">All squads</option>
          {a.squads.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select name="lob" defaultValue={f.lob ?? ""} className={selectCls} aria-label="Line of Business">
          <option value="">All lines of business</option>
          {a.lobs.filter((l) => !f.squad || l.squadId === f.squad).map((l) => <option key={l.id} value={l.id}>{l.key} · {l.name}</option>)}
        </select>
        <select name="sprint" defaultValue={sprint?.id ?? ""} className={selectCls} aria-label="Sprint">
          {a.sprints
            .filter((s) => (!f.squad || s.squadId === f.squad) && (!f.lob || s.lobId === f.lob))
            .slice()
            .reverse()
            .map((s) => <option key={s.id} value={s.id}>{s.lobKey} · {s.name} ({s.state.toLowerCase()})</option>)}
        </select>
        <select name="level" defaultValue={level} className={selectCls} aria-label="Show">
          <option value="tasks">Tasks</option>
          <option value="stories">Stories and bugs</option>
        </select>
        <select name="group" defaultValue={group} className={selectCls} aria-label="Group by">
          <option value="status">Columns: status</option>
          <option value="member">Columns: member (tasks)</option>
        </select>
        <select name="assignee" defaultValue={f.assignee ?? ""} className={selectCls} aria-label="Assignee">
          <option value="">Any assignee</option>
          <option value="none">Unassigned</option>
          {a.members.filter((m) => m.active).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <select name="parentType" defaultValue={f.parentType ?? ""} className={selectCls} aria-label="Story or bug">
          <option value="">Stories and bugs</option>
          <option value="STORY">Stories only</option>
          <option value="BUG">Bugs only</option>
        </select>
        <label className="flex items-center gap-1 text-sm text-slate-700">
          <input type="checkbox" name="blocked" value="1" defaultChecked={f.blocked === "1"} /> Blocked
        </label>
        <input name="q" defaultValue={f.q} placeholder="Title or ID" className={`${selectCls} w-36`} aria-label="Search" />
        <button className={applyCls}>Apply</button>
        <Link href="/board" className="px-2 py-1.5 text-sm text-slate-500 hover:text-slate-800">Clear</Link>
      </form>
    </Card>
  );

  if (!sprint) {
    return (
      <>
        <PageHeader title="Sprint Board" />
        {header}
        <Card><Empty>No sprint to show. <Link href="/sprints" className="text-orange-700 underline">Create a sprint</Link> first.</Empty></Card>
      </>
    );
  }

  // Epic / Feature filter is chosen from the sprint's own LOB.
  const lobItems = await db.workItem.findMany({
    where: { lobId: sprint.lobId },
    select: { id: true, number: true, title: true, type: true, parentId: true },
  });
  const byId = new Map(lobItems.map((i) => [i.id, i]));
  const scopeOptions = lobItems.filter((i) => i.type === "EPIC" || i.type === "FEATURE");
  const ancestors = (id: string | null): string[] => {
    const out: string[] = [];
    let cur = id ? byId.get(id) : undefined;
    while (cur) {
      out.push(cur.id);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return out;
  };

  const rows = await db.workItem.findMany({
    where: { sprintId: sprint.id, type: level === "tasks" ? "TASK" : { in: ["STORY", "BUG"] } },
    orderBy: [{ rank: "asc" }, { number: "asc" }],
  });
  const q = f.q?.trim().toLowerCase();
  const filtered = rows.filter((r) => {
    const parent = r.parentId ? byId.get(r.parentId) : undefined;
    const storyType = level === "tasks" ? parent?.type : r.type;
    if (f.parentType && storyType !== f.parentType) return false;
    if (f.blocked && !r.blocked) return false;
    if (f.assignee === "none" && r.assigneeId) return false;
    if (f.assignee && f.assignee !== "none" && r.assigneeId !== f.assignee) return false;
    if (f.scope && !ancestors(r.id).includes(f.scope)) return false;
    if (q && !r.title.toLowerCase().includes(q) && !itemKey(sprint.lobKey, r.number).toLowerCase().startsWith(q)) return false;
    return true;
  });
  const memberName = new Map(a.members.map((m) => [m.id, m.name]));
  const cards: BoardCard[] = filtered.map((r) => {
    const parent = r.parentId ? byId.get(r.parentId) : undefined;
    return {
      id: r.id,
      key: itemKey(sprint.lobKey, r.number),
      title: r.title,
      type: r.type,
      status: r.status,
      priority: r.priority,
      assigneeId: r.assigneeId,
      assigneeName: r.assigneeId ? memberName.get(r.assigneeId) ?? null : null,
      hours: r.type === "TASK" ? r.estimateHours : null,
      blocked: r.blocked,
      parentLabel: level === "tasks" && parent ? `${itemKey(sprint.lobKey, parent.number)} ${parent.title}` : "",
    };
  });

  let columns: BoardColumn[];
  if (group === "member") {
    const squadMembers = a.members.filter((m) => m.active && m.squadIds.includes(sprint.squadId));
    const withTasks = new Set(cards.map((c) => c.assigneeId).filter(Boolean) as string[]);
    const shown = f.assignee === "none" ? [] : squadMembers.filter((m) => !f.assignee || f.assignee === m.id);
    const extra = [...withTasks].filter((id) => !squadMembers.some((m) => m.id === id));
    columns = [
      { id: "none", title: "Unassigned" },
      ...shown.map((m) => ({
        id: m.id,
        title: m.name,
        sub: `${fmtH(sprint.summary.byMember[m.id]?.assigned ?? 0)} of ${fmtH(sprint.summary.capacityByMember[m.id] ?? 0)}`,
      })),
      ...extra.map((id) => ({ id, title: memberName.get(id) ?? "Removed member" })),
    ];
  } else {
    const list = level === "tasks" ? statusesFor("TASK") : statusesFor("STORY");
    columns = list.map((s) => ({ id: s, title: STATUS_LABEL[s] }));
  }

  const sum = sprint.summary;
  return (
    <RoleProvider readOnly={!me.permissions.has("board.move")}>
    <>
      <PageHeader
        title="Sprint Board"
        description={`${sprint.lobKey} · ${sprint.name} · ${sprint.squadName}`}
        actions={<div className="flex items-center gap-2"><SprintStateBadge state={sprint.state} />{sprint.state !== "PLANNED" && <HealthBadge health={sum.health} />}<Link href={`/sprints/${sprint.id}`} className="text-sm text-orange-700 hover:underline">Open sprint</Link></div>}
      />
      {header}
      {sprint.state === "PAUSED" && (
        <p role="status" className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          This sprint is paused{sprint.pauses.find((p) => !p.resumedOn)?.reason ? `: ${sprint.pauses.find((p) => !p.resumedOn)!.reason}` : ""}. You can still move cards, but its tasks are not scheduled until it resumes.
        </p>
      )}

      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-2 text-sm">
          <div><span className="text-slate-500">Done</span> <strong>{fmtH(sum.doneHours)}</strong> of <strong>{fmtH(sum.currentHours)}</strong> planned</div>
          <div><span className="text-slate-500">Capacity</span> <strong>{fmtH(sum.totalCapacity)}</strong></div>
          <div className="flex items-center gap-2"><span className="text-slate-500">Load</span> <LoadBar assigned={sum.currentHours} capacity={sum.totalCapacity} /></div>
          <div><span className="text-slate-500">Remaining</span> <strong>{fmtH(sum.remainingHours)}</strong></div>
          <div><span className="text-slate-500">Blocked</span> <strong>{sum.blockedTasks}</strong></div>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200" aria-hidden="true">
          <div className="h-full bg-orange-500" style={{ width: `${sum.currentHours > 0 ? Math.min(100, (sum.doneHours / sum.currentHours) * 100) : 0}%` }} />
        </div>
        {scopeOptions.length > 0 && (
          <form className="mt-3 flex items-center gap-2 text-xs text-slate-500">
            {Object.entries({ squad: f.squad, lob: f.lob, sprint: sprint.id, level, group, assignee: f.assignee, parentType: f.parentType, blocked: f.blocked, q: f.q }).map(([k, v]) => v ? <input key={k} type="hidden" name={k} value={v} /> : null)}
            Epic / Feature:
            <select name="scope" defaultValue={f.scope ?? ""} className={selectCls}>
              <option value="">All</option>
              {scopeOptions.map((i) => <option key={i.id} value={i.id}>{itemKey(sprint.lobKey, i.number)} {i.type === "EPIC" ? "Epic" : "Feature"}: {i.title}</option>)}
            </select>
            <button className="rounded-md border border-slate-300 px-2 py-1">Filter</button>
          </form>
        )}
      </Card>

      {cards.length === 0 ? (
        <Card><Empty>{rows.length === 0 ? "This sprint has no items yet." : "Nothing matches the filters."}</Empty></Card>
      ) : (
        <Board key={`${sprint.id}-${level}-${group}-${cards.map((c) => c.id + c.status + (c.assigneeId ?? "")).join()}`} cards={cards} columns={columns} group={group} />
      )}
    </>
    </RoleProvider>
  );
}
