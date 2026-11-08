import Link from "next/link";
import { notFound } from "next/navigation";
import type { WorkItemStatus } from "@/lib/enums";
import { db } from "@/lib/db";
import { deleteWorkItem, updateWorkItem } from "@/lib/actions/work-items";
import {
  PARENT_REQUIRED,
  PARENT_TYPES,
  PRIORITIES,
  PRIORITY_LABEL,
  STATUS_LABEL,
  TYPE_LABEL,
  childTypesOf,
  itemKey,
  progressPercent,
  rollup,
  statusesFor,
  type RollupNode,
} from "@/lib/work-items";
import { ActionForm, DeleteButton, SubmitButton } from "@/components/ui/forms";
import { Card, Empty, Field, Input, LinkButton, Select, Stat, Textarea } from "@/components/ui";
import { PriorityLabel, ProgressBar, TypeBadge, formatHours } from "@/components/work-items/badges";
import { StatusSelect } from "@/components/work-items/status-select";
import { NewItemForm } from "@/components/work-items/new-item-form";
import { SprintSelect } from "@/components/item-actions";
import { EditOnly } from "@/components/edit-only";

type TreeItem = { id: string; type: RollupNode["type"]; status: WorkItemStatus; estimateHours: number | null; parentId: string | null };

export default async function ItemPage({ params }: PageProps<"/items/[id]">) {
  const { id } = await params;
  const item = await db.workItem.findUnique({
    where: { id },
    include: {
      lob: { include: { squad: true } },
      parent: { select: { id: true, number: true, title: true, type: true, parentId: true } },
      children: { orderBy: [{ rank: "asc" }, { number: "asc" }], include: { assignee: { select: { name: true } } } },
      history: { orderBy: { changedAt: "desc" }, take: 100 },
    },
  });
  if (!item) notFound();

  const [lobItems, squadMembers, allMembers, sprintChoices] = await Promise.all([
    db.workItem.findMany({
      where: { lobId: item.lobId },
      select: { id: true, number: true, title: true, type: true, status: true, estimateHours: true, parentId: true },
    }),
    db.squadMembership.findMany({
      where: { squadId: item.lob.squadId, member: { active: true } },
      include: { member: { select: { id: true, name: true } } },
      orderBy: { member: { name: "asc" } },
    }),
    db.member.findMany({ select: { id: true, name: true } }),
    db.sprint.findMany({ where: { lobId: item.lobId, OR: [{ state: { not: "CLOSED" } }, { id: item.sprintId ?? "" }] }, orderBy: { startDate: "asc" }, select: { id: true, name: true, state: true } }),
  ]);

  const key = itemKey(item.lob.key, item.number);
  const memberName = new Map(allMembers.map((m) => [m.id, m.name]));
  const itemLabel = new Map(lobItems.map((i) => [i.id, `${itemKey(item.lob.key, i.number)} ${i.title}`]));

  // Roll-up for this item from the whole LOB tree.
  const byParent = new Map<string | null, TreeItem[]>();
  for (const i of lobItems) {
    const list = byParent.get(i.parentId) ?? [];
    list.push(i);
    byParent.set(i.parentId, list);
  }
  const toNode = (i: TreeItem): RollupNode => ({ type: i.type, status: i.status, estimateHours: i.estimateHours, children: (byParent.get(i.id) ?? []).map(toNode) });
  const r = rollup(toNode(item));
  const progress = progressPercent(r);

  // Breadcrumb
  const crumbs: { id: string; label: string }[] = [];
  let cur = item.parentId ? lobItems.find((i) => i.id === item.parentId) : undefined;
  while (cur) {
    crumbs.unshift({ id: cur.id, label: `${itemKey(item.lob.key, cur.number)} ${cur.title}` });
    cur = cur.parentId ? lobItems.find((i) => i.id === cur!.parentId) : undefined;
  }

  // Parent choices (same LOB, allowed types, not itself or its own descendants).
  const descendants = new Set<string>();
  const collect = (pid: string) => (byParent.get(pid) ?? []).forEach((c) => { descendants.add(c.id); collect(c.id); });
  collect(item.id);
  const parentChoices = lobItems.filter((i) => PARENT_TYPES[item.type].includes(i.type) && i.id !== item.id && !descendants.has(i.id));

  const statuses = statusesFor(item.type);
  const isTask = item.type === "TASK";
  const childTypes = childTypesOf(item.type);

  const describe = (field: string, v: string | null): string => {
    if (v == null) return "—";
    if (field === "status") return STATUS_LABEL[v as WorkItemStatus] ?? v;
    if (field === "priority") return PRIORITY_LABEL[v as keyof typeof PRIORITY_LABEL] ?? v;
    if (field === "assignee") return memberName.get(v) ?? "(removed member)";
    if (field === "estimate") return `${v}h`;
    if (field === "parent") return itemLabel.get(v) ?? "(deleted item)";
    if (field === "created") return TYPE_LABEL[v as keyof typeof TYPE_LABEL] ?? v;
    return v;
  };

  return (
    <>
      <nav className="mb-2 flex flex-wrap items-center gap-1 text-xs text-slate-500">
        <Link href={`/backlog?lob=${item.lobId}`} className="hover:underline">{item.lob.key} · {item.lob.name}</Link>
        {crumbs.map((c) => (
          <span key={c.id}>
            {" / "}
            <Link href={`/items/${c.id}`} className="hover:underline">{c.label}</Link>
          </span>
        ))}
      </nav>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <TypeBadge type={item.type} />
            <span className="font-mono text-sm text-slate-500">{key}</span>
            {item.blocked && <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">Blocked</span>}
          </div>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">{item.title}</h1>
        </div>
        <LinkButton href={`/backlog?lob=${item.lobId}`}>← Backlog</LinkButton>
      </div>

      {!isTask && (
        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat label="Total hours" value={formatHours(r.totalHours)} hint="Sum of task estimates" />
          <Stat label="Done hours" value={formatHours(r.doneHours)} />
          <Stat label="Progress" value={progress == null ? "—" : `${progress}%`} />
          <Stat label="Tasks without estimate" value={r.unestimatedTasks} />
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_24rem]">
        <div className="space-y-6">
          <Card title="Details">
            <ActionForm action={updateWorkItem} className="space-y-4" successMessage="Saved." resetOnSuccess={false}>
              <input type="hidden" name="id" value={item.id} />
              <Field label="Title">
                <Input name="title" required maxLength={200} defaultValue={item.title} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-3">
                {statuses.length > 0 && (
                  <Field label="Status">
                    <Select name="status" defaultValue={item.status}>
                      {statuses.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                    </Select>
                  </Field>
                )}
                <Field label="Priority">
                  <Select name="priority" defaultValue={item.priority}>
                    {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
                  </Select>
                </Field>
                {PARENT_TYPES[item.type].length > 0 && (
                  <Field label={PARENT_REQUIRED[item.type] ? "Parent" : "Parent (optional)"}>
                    <Select name="parentId" defaultValue={item.parentId ?? ""} required={PARENT_REQUIRED[item.type]}>
                      {!PARENT_REQUIRED[item.type] && <option value="">No parent</option>}
                      {parentChoices.map((p) => (
                        <option key={p.id} value={p.id}>{itemKey(item.lob.key, p.number)} · {p.title}</option>
                      ))}
                    </Select>
                  </Field>
                )}
              </div>
              {isTask && (
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="Assignee" className="sm:col-span-2">
                    <Select name="assigneeId" defaultValue={item.assigneeId ?? ""}>
                      <option value="">Unassigned</option>
                      {item.assigneeId && !squadMembers.some((m) => m.memberId === item.assigneeId) && (
                        <option value={item.assigneeId}>{memberName.get(item.assigneeId) ?? "Removed member"} (not in squad)</option>
                      )}
                      {squadMembers.map((m) => <option key={m.member.id} value={m.member.id}>{m.member.name}</option>)}
                    </Select>
                  </Field>
                  <Field label="Estimate (hours)">
                    <Input type="number" name="estimateHours" min="0" max="1000" step="0.25" defaultValue={item.estimateHours ?? ""} />
                  </Field>
                </div>
              )}
              <Field label="Description">
                <Textarea name="description" rows={5} maxLength={10000} defaultValue={item.description} />
              </Field>
              {(item.type === "STORY" || item.type === "BUG") && (
                <Field label="Acceptance criteria">
                  <Textarea name="acceptanceCriteria" rows={4} maxLength={10000} defaultValue={item.acceptanceCriteria} />
                </Field>
              )}
              <div className="rounded-md border border-slate-200 p-3">
                <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                  <input type="checkbox" name="blocked" defaultChecked={item.blocked} /> Blocked
                </label>
                <Input name="blockedReason" maxLength={500} placeholder="Why is it blocked? (optional)" defaultValue={item.blockedReason} className="mt-2" />
              </div>
              <SubmitButton>Save changes</SubmitButton>
            </ActionForm>
          </Card>

          {childTypes.length > 0 && (
            <Card title={`${childTypes.map((t) => TYPE_LABEL[t]).join(" / ")} items (${item.children.length})`}>
              <EditOnly>
              <div className="mb-4">
                <NewItemForm
                  lobs={[{ id: item.lobId, name: item.lob.name, key: item.lob.key, squadId: item.lob.squadId }]}
                  parents={[]}
                  membersBySquad={{ [item.lob.squadId]: squadMembers.map((m) => m.member) }}
                  fixedParent={{ id: item.id, key, title: item.title, type: item.type, lobId: item.lobId }}
                />
              </div>
              </EditOnly>
              {item.children.length === 0 ? (
                <Empty>Nothing here yet.</Empty>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {item.children.map((c) => {
                    const cr = rollup(toNode(c));
                    return (
                      <li key={c.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                        <TypeBadge type={c.type} short />
                        <Link href={`/items/${c.id}`} className="font-mono text-xs text-slate-500 hover:underline">{itemKey(item.lob.key, c.number)}</Link>
                        <Link href={`/items/${c.id}`} className="min-w-0 flex-1 truncate hover:underline">{c.title}</Link>
                        {c.blocked && <span className="rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-semibold text-red-700">Blocked</span>}
                        <PriorityLabel priority={c.priority} />
                        {c.type === "TASK" ? (
                          <>
                            <span className="text-xs text-slate-600">{c.assignee?.name ?? <span className="text-amber-700">Unassigned</span>}</span>
                            <span className="w-20 text-right text-xs">{c.estimateHours == null ? <span className="text-amber-700">No estimate</span> : formatHours(c.estimateHours)}</span>
                          </>
                        ) : (
                          <ProgressBar value={progressPercent(cr)} />
                        )}
                        {statusesFor(c.type).length > 0 && <StatusSelect key={`${c.id}-${c.status}`} id={c.id} status={c.status} options={statusesFor(c.type)} />}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card title="Summary">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-slate-500">Line of Business</dt><dd>{item.lob.name}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Squad</dt><dd>{item.lob.squad.name}</dd></div>
              {statuses.length > 0 && (
                <div className="flex items-center justify-between"><dt className="text-slate-500">Status</dt><dd><StatusSelect key={item.status} id={item.id} status={item.status} options={statuses} /></dd></div>
              )}
              {(item.type === "STORY" || item.type === "BUG") && (
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-slate-500">Sprint</dt>
                  <dd><SprintSelect itemId={item.id} value={item.sprintId ?? ""} options={sprintChoices.map((x) => ({ id: x.id, name: `${x.name}${x.state === "CLOSED" ? " (closed)" : ""}` }))} /></dd>
                </div>
              )}
              {isTask && item.sprintId && <div className="flex justify-between"><dt className="text-slate-500">Sprint</dt><dd><Link href={`/sprints/${item.sprintId}`} className="text-orange-700 hover:underline">{sprintChoices.find((x) => x.id === item.sprintId)?.name ?? "Sprint"}</Link></dd></div>}
              {!isTask && <div className="flex justify-between"><dt className="text-slate-500">Progress</dt><dd><ProgressBar value={progress} /></dd></div>}
              <div className="flex justify-between"><dt className="text-slate-500">Created</dt><dd>{item.createdAt.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</dd></div>
              {item.doneAt && <div className="flex justify-between"><dt className="text-slate-500">Done</dt><dd>{item.doneAt.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</dd></div>}
            </dl>
          </Card>

          <Card title="History">
            {item.history.length === 0 ? (
              <Empty>No changes yet.</Empty>
            ) : (
              <ol className="space-y-2 text-sm">
                {item.history.map((h) => (
                  <li key={h.id} className="border-l-2 border-orange-200 pl-3">
                    <div className="text-xs text-slate-500">{h.changedAt.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</div>
                    {h.field === "created" ? (
                      <div>Created as {describe("created", h.newValue)}</div>
                    ) : (
                      <div>
                        <span className="font-medium capitalize">{h.field}</span>: {describe(h.field, h.oldValue)} → {describe(h.field, h.newValue)}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <EditOnly>
          <Card title="Delete">
            <p className="mb-3 text-sm text-slate-500">Items with children cannot be deleted until the children are removed or moved.</p>
            <DeleteButton action={deleteWorkItem} id={item.id} label={`Delete ${TYPE_LABEL[item.type]}`} confirmText={`Delete ${key} "${item.title}"? This cannot be undone.`} />
          </Card>
          </EditOnly>
        </div>
      </div>
    </>
  );
}
