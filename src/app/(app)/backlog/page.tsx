import Link from "next/link";
import { requirePageAccess, can } from "@/lib/auth";
import { RoleProvider } from "@/components/role-provider";
import { db } from "@/lib/db";
import { hasItemFilters, loadBacklog, type BacklogFilters } from "@/lib/backlog";
import { loadItemFormOptions } from "@/lib/item-options";
import { PRIORITIES, PRIORITY_LABEL, STATUS_LABEL, TYPES, TYPE_LABEL } from "@/lib/work-items";
import { BacklogTree } from "@/components/work-items/backlog-tree";
import { NewItemForm } from "@/components/work-items/new-item-form";
import { Card, Empty, LinkButton, PageHeader, cn, primaryButton } from "@/components/ui";
import { Can } from "@/components/edit-only";

const selectCls = "rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm";

export default async function BacklogPage({ searchParams }: PageProps<"/backlog">) {
  const me = await requirePageAccess("backlog.view");
  const f = (await searchParams) as BacklogFilters;
  const [groups, squads, allLobs, members] = await Promise.all([
    loadBacklog(f),
    db.squad.findMany({ orderBy: { name: "asc" } }),
    db.lineOfBusiness.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, key: true, squadId: true } }),
    db.member.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const scopeLobs = allLobs.filter((l) => (!f.squad || l.squadId === f.squad) && (!f.lob || l.id === f.lob));
  const options = await loadItemFormOptions(scopeLobs.map((l) => l.id));
  const filtering = hasItemFilters(f);
  const shownCount = groups.reduce((s, g) => s + g.rows.filter((r) => r.matched).length, 0);
  const totalCount = groups.reduce((s, g) => s + g.totalItems, 0);

  return (
    <RoleProvider readOnly={!me.permissions.has("backlog.edit")}>
    <>
      <PageHeader title="Backlog" description="Epics → Features → User Stories / Bugs → Tasks for every line of business." actions={(await can("sprints.import")) ? <LinkButton href="/sprints/import">Import from sprint planning sheet</LinkButton> : undefined} />

      <Card className="mb-4">
        <form className="flex flex-wrap items-end gap-2">
          <select name="squad" defaultValue={f.squad ?? ""} className={selectCls} aria-label="Squad">
            <option value="">All squads</option>
            {squads.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select name="lob" defaultValue={f.lob ?? ""} className={selectCls} aria-label="Line of Business">
            <option value="">All lines of business</option>
            {allLobs.filter((l) => !f.squad || l.squadId === f.squad).map((l) => <option key={l.id} value={l.id}>{l.key} · {l.name}</option>)}
          </select>
          <select name="type" defaultValue={f.type ?? ""} className={selectCls} aria-label="Type">
            <option value="">All types</option>
            {TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
          </select>
          <select name="status" defaultValue={f.status ?? ""} className={selectCls} aria-label="Status">
            <option value="">All statuses</option>
            {(["NEW", "APPROVED", "COMMITTED", "IN_PROGRESS", "DONE"] as const).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
          <select name="assignee" defaultValue={f.assignee ?? ""} className={selectCls} aria-label="Assignee">
            <option value="">Any assignee</option>
            <option value="none">Unassigned tasks</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <select name="priority" defaultValue={f.priority ?? ""} className={selectCls} aria-label="Priority">
            <option value="">Any priority</option>
            {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
          </select>
          <label className="flex items-center gap-1 text-sm text-slate-700">
            <input type="checkbox" name="blocked" value="1" defaultChecked={f.blocked === "1"} /> Blocked
          </label>
          <label className="flex items-center gap-1 text-sm text-slate-700">
            <input type="checkbox" name="noEstimate" value="1" defaultChecked={f.noEstimate === "1"} /> No estimate
          </label>
          <label className="flex items-center gap-1 text-xs text-slate-500">
            Created
            <input type="date" name="from" defaultValue={f.from} className={selectCls} aria-label="Created from" />
            –
            <input type="date" name="to" defaultValue={f.to} className={selectCls} aria-label="Created to" />
          </label>
          <input name="q" defaultValue={f.q} placeholder="Title or ID (e.g. RB-12)" className={`${selectCls} w-52`} aria-label="Search" />
          <button className={cn("rounded-lg px-3.5 py-1.5 text-sm", primaryButton)}>Apply</button>
          <Link href="/backlog" className="px-2 py-1.5 text-sm text-slate-500 hover:text-slate-800">Clear</Link>
        </form>
      </Card>

      <Can perm="backlog.edit">
      <Card title="New item" className="mb-4">
        {options.lobs.length === 0 ? (
          <Empty>
            Create a line of business first. <LinkButton href="/lobs" className="ml-1 px-2 py-1 text-xs">Go to lines of business</LinkButton>
          </Empty>
        ) : (
          <NewItemForm {...options} defaultLobId={f.lob} />
        )}
      </Card>
      </Can>

      {groups.length === 0 ? (
        <Card><Empty>No lines of business match these filters.</Empty></Card>
      ) : (
        <>
          <p className="mb-2 text-sm text-slate-500">
            {filtering ? `${shownCount} matching item(s) out of ${totalCount}. Greyed rows are parents shown for context.` : `${totalCount} item(s).`}
          </p>
          <div className="space-y-4">
            {groups.map((g) => (
              <Card
                key={g.lob.id}
                title={`${g.lob.key} · ${g.lob.name}`}
                actions={<span className="text-xs text-slate-500">Squad: {g.lob.squadName}</span>}
              >
                {g.rows.length === 0 ? (
                  <Empty>{filtering ? "Nothing matches the filters here." : "No items yet."}</Empty>
                ) : (
                  <BacklogTree rows={g.rows} canReorder={!filtering} />
                )}
              </Card>
            ))}
          </div>
        </>
      )}
    </>
    </RoleProvider>
  );
}
