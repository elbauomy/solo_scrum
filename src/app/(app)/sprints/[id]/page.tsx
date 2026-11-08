import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { loadAnalytics } from "@/lib/analytics";
import { formatDate, toISODate } from "@/lib/dates";
import { addWorkingDays, workingDaysBetween } from "@/lib/capacity";
import { addDays } from "@/lib/dates";
import { itemKey } from "@/lib/work-items";
import { closeSprint, deleteSprint, pauseSprint, resumeSprint, saveSprintShare, startSprint, updateSprint } from "@/lib/actions/sprints";
import { ActionForm, DeleteButton, SubmitButton } from "@/components/ui/forms";
import { BurndownChart } from "@/components/charts";
import { SprintButton } from "@/components/item-actions";
import { HealthBadge, HealthParts, LoadBar, SprintStateBadge, fmtH, healthText } from "@/components/sprint-ui";
import { StatusBadge, TypeBadge } from "@/components/work-items/badges";
import { Badge, Card, Empty, Field, Input, LinkButton, PageHeader, Select, Stat, Table, Td, Textarea, Th } from "@/components/ui";
import { EditOnly, canEdit } from "@/components/edit-only";

export default async function SprintPage({ params, searchParams }: PageProps<"/sprints/[id]">) {
  const { id } = await params;
  const { q } = (await searchParams) as { q?: string };
  const a = await loadAnalytics();
  const s = a.sprints.find((x) => x.id === id);
  if (!s) notFound();
  const sum = s.summary;
  const edit = await canEdit();
  const editable = s.state !== "CLOSED" && edit;

  const lob = await db.lineOfBusiness.findUniqueOrThrow({ where: { id: s.lobId } });
  const [inSprint, candidates] = await Promise.all([
    db.workItem.findMany({
      where: { sprintId: id, type: { in: ["STORY", "BUG"] } },
      orderBy: [{ rank: "asc" }, { number: "asc" }],
      include: { children: { where: { type: "TASK" }, select: { estimateHours: true, status: true, sprintId: true } } },
    }),
    editable
      ? db.workItem.findMany({
          where: {
            lobId: s.lobId,
            type: { in: ["STORY", "BUG"] },
            sprintId: null,
            status: { not: "DONE" },
            ...(q ? { title: { contains: q } } : {}),
          },
          orderBy: [{ priority: "asc" }, { rank: "asc" }, { number: "asc" }],
          include: { children: { where: { type: "TASK" }, select: { estimateHours: true, status: true } } },
          take: 100,
        })
      : Promise.resolve([]),
  ]);

  const hoursOf = (kids: { estimateHours: number | null; status: string }[], onlyOpen = false) =>
    kids.filter((k) => !onlyOpen || k.status !== "DONE").reduce((sum, k) => sum + (k.estimateHours ?? 0), 0);

  const overlapping = a.sprints.filter((x) => x.squadId === s.squadId && x.id !== s.id && x.start <= s.end && x.end >= s.start);
  const otherOpen = a.sprints.filter((x) => x.lobId === s.lobId && x.id !== s.id && x.state !== "CLOSED");
  const releases = a.releases.filter((r) => r.lobId === s.lobId);
  const memberName = new Map(a.members.map((m) => [m.id, m.name]));
  const memberIds = [...new Set([...Object.keys(sum.capacityByMember), ...Object.keys(sum.byMember)])];
  const rows = memberIds
    .map((mid) => ({
      id: mid,
      name: memberName.get(mid) ?? "Removed member",
      capacity: sum.capacityByMember[mid] ?? 0,
      assigned: sum.byMember[mid]?.assigned ?? 0,
      done: sum.byMember[mid]?.done ?? 0,
      plan: sum.plans?.[mid] ?? null,
    }))
    .sort((x, y) => x.name.localeCompare(y.name));
  const openPause = s.pauses.find((p) => !p.resumedOn) ?? null;
  // If it resumed today, how far would the end date move?
  const pausedWorkingDays = openPause && a.today.getTime() > openPause.start.getTime() ? workingDaysBetween(openPause.start, addDays(a.today, -1), a.cal) : 0;
  const extendedEnd = pausedWorkingDays > 0 ? addWorkingDays(s.end, pausedWorkingDays, a.cal) : s.end;
  const todayISO = toISODate(a.today);
  const loadPct = sum.totalCapacity > 0 ? Math.round((sum.currentHours / sum.totalCapacity) * 100) : null;

  return (
    <>
      <PageHeader
        title={s.name}
        description={`${s.lobKey} · ${s.lobName} · ${s.squadName} · ${formatDate(s.start)} – ${formatDate(s.end)} (${s.lengthDays} days)`}
        actions={
          <div className="flex items-center gap-2">
            <SprintStateBadge state={s.state} />
            {s.state !== "PLANNED" && <HealthBadge health={sum.health} />}
            <LinkButton href="/sprints">← Sprints</LinkButton>
            {edit && <LinkButton href="#edit">Edit sprint</LinkButton>}
            <LinkButton href={`/board?sprint=${s.id}`}>Open board</LinkButton>
          </div>
        }
      />
      {s.goal && <p className="mb-4 rounded-md bg-orange-50 px-3 py-2 text-sm text-orange-900"><strong>Goal:</strong> {s.goal}</p>}
      {openPause && (
        <p role="status" className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <strong>Paused since {formatDate(openPause.start)}</strong>
          {openPause.reason ? ` — ${openPause.reason}` : ""}. Its tasks are not scheduled and it takes no share of anyone&apos;s hours until you resume it.
        </p>
      )}

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat label={s.state === "PLANNED" ? "Planned hours" : "Committed"} value={fmtH(sum.committedHours)} hint={s.state === "PLANNED" ? "Locked in when the sprint starts" : "Snapshot at sprint start"} />
        <Stat label="Done" value={fmtH(sum.doneHours)} hint={sum.reliabilityPct == null ? undefined : `${Math.round(sum.reliabilityPct)}% of commitment`} />
        <Stat label="Remaining" value={fmtH(sum.remainingHours)} hint={`${sum.openTasks} open task(s)`} />
        <Stat label="Capacity" value={fmtH(sum.totalCapacity)} hint={loadPct == null ? "No members with hours" : `Load ${loadPct}%`} />
        <Stat label="Scope change" value={`${Math.round(sum.scopeChangePct)}%`} hint={s.state === "PLANNED" ? "Measured after start" : `+${fmtH(sum.addedHours)} / −${fmtH(sum.removedHours)}`} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          {s.state !== "PLANNED" && (
            <Card title="Burndown">
              <BurndownChart data={sum.burndown} />
              <p className="mt-2 text-xs text-slate-500">Hours burn down when a task is marked Done. The ideal line falls over working days from the committed hours.</p>
            </Card>
          )}

          <Card title={`Stories and bugs in this sprint (${inSprint.length})`}>
            {inSprint.length === 0 ? (
              <Empty>Nothing planned yet. Add items from the list below.</Empty>
            ) : (
              <Table>
                <thead>
                  <tr><Th>Item</Th><Th>Status</Th><Th className="text-right">Open hours</Th><Th className="text-right">Total hours</Th><Th /></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {inSprint.map((i) => (
                    <tr key={i.id}>
                      <Td>
                        <div className="flex items-center gap-2">
                          <TypeBadge type={i.type} short />
                          <Link href={`/items/${i.id}`} className="font-mono text-xs text-slate-500 hover:underline">{itemKey(lob.key, i.number)}</Link>
                          <Link href={`/items/${i.id}`} className="hover:underline">{i.title}</Link>
                          {i.blocked && <Badge tone="red">Blocked</Badge>}
                        </div>
                      </Td>
                      <Td><StatusBadge status={i.status} /></Td>
                      <Td className="text-right">{fmtH(hoursOf(i.children, true))}</Td>
                      <Td className="text-right">{fmtH(hoursOf(i.children))}</Td>
                      <Td className="text-right">{editable && <SprintButton itemId={i.id} sprintId={null} label="Remove" variant="danger" />}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          {editable && (
            <EditOnly>
            <Card
              title={`Add from backlog (${candidates.length})`}
              actions={
                <form className="flex gap-2">
                  <input name="q" defaultValue={q} placeholder="Search title…" className="w-40 rounded-md border border-slate-300 px-2 py-1 text-sm" />
                  <button className="rounded-md border border-slate-300 px-2 py-1 text-sm">Search</button>
                </form>
              }
            >
              {candidates.length === 0 ? (
                <Empty>No stories or bugs waiting in the backlog of this line of business.</Empty>
              ) : (
                <Table>
                  <thead>
                    <tr><Th>Item</Th><Th>Priority</Th><Th>Status</Th><Th className="text-right">Hours</Th><Th /></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {candidates.map((i) => {
                      const missing = i.children.filter((k) => k.estimateHours == null).length;
                      return (
                        <tr key={i.id}>
                          <Td>
                            <div className="flex items-center gap-2">
                              <TypeBadge type={i.type} short />
                              <span className="font-mono text-xs text-slate-500">{itemKey(lob.key, i.number)}</span>
                              <Link href={`/items/${i.id}`} className="hover:underline">{i.title}</Link>
                            </div>
                          </Td>
                          <Td className="text-xs">{i.priority.charAt(0) + i.priority.slice(1).toLowerCase()}</Td>
                          <Td><StatusBadge status={i.status} /></Td>
                          <Td className="text-right">
                            {fmtH(hoursOf(i.children))}
                            {(missing > 0 || i.children.length === 0) && <span className="ml-1 text-amber-700" title={i.children.length === 0 ? "No tasks yet" : `${missing} task(s) without estimate`}>⚠</span>}
                          </Td>
                          <Td className="text-right"><SprintButton itemId={i.id} sprintId={s.id} label="Add to sprint" variant="primary" /></Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              )}
            </Card>
            </EditOnly>
          )}
        </div>

        <div className="space-y-6">
          {s.state !== "PLANNED" && (
            <Card title={`Health — ${healthText(sum.health.level)}`}>
              <div className="mb-3 text-3xl font-semibold text-slate-900">{sum.health.score}<span className="text-base text-slate-400"> / 100</span></div>
              <HealthParts parts={sum.health.parts} />
            </Card>
          )}

          <EditOnly>
          <Card title="Sprint status">
            {s.state === "PLANNED" && (
              <ActionForm action={startSprint} resetOnSuccess={false}>
                <input type="hidden" name="id" value={s.id} />
                <p className="mb-2 text-xs text-slate-500">Starting saves a snapshot of the planned hours. Scope changes are measured against it.</p>
                <SubmitButton className="w-full">Start sprint</SubmitButton>
              </ActionForm>
            )}

            {s.state === "ACTIVE" && (
              <ActionForm action={pauseSprint} className="space-y-2" resetOnSuccess={false}>
                <input type="hidden" name="id" value={s.id} />
                <p className="text-xs text-slate-500">Pause the sprint when the team has to stop working on it (for example they were pulled onto something urgent). While paused its tasks are not scheduled and it takes no share of anyone&apos;s hours.</p>
                <Field label="Paused from"><Input type="date" name="date" required min={toISODate(s.start)} max={todayISO} defaultValue={todayISO} /></Field>
                <Field label="Reason (optional)"><Input name="reason" maxLength={500} placeholder="e.g. Production incident" /></Field>
                <SubmitButton variant="secondary" className="w-full">Pause sprint</SubmitButton>
              </ActionForm>
            )}

            {s.state === "PAUSED" && openPause && (
              <ActionForm action={resumeSprint} className="space-y-2" resetOnSuccess={false}>
                <input type="hidden" name="id" value={s.id} />
                <Field label="Back to work on" hint="The first day the team works on the sprint again.">
                  <Input type="date" name="date" required min={toISODate(openPause.start)} max={todayISO} defaultValue={todayISO} />
                </Field>
                <label className="flex items-start gap-2 text-sm text-slate-700">
                  <input type="checkbox" name="extend" defaultChecked className="mt-1" />
                  <span>
                    Move the end date out by the working days it was paused
                    <span className="block text-xs text-slate-500">
                      {pausedWorkingDays > 0 ? `${pausedWorkingDays} working day(s) so far: ${formatDate(s.end)} → ${formatDate(extendedEnd)} if you resume today.` : "No working days have been lost so far."}
                    </span>
                  </span>
                </label>
                <SubmitButton className="w-full">Resume sprint</SubmitButton>
              </ActionForm>
            )}

            {(s.state === "ACTIVE" || s.state === "PAUSED") && (
              <ActionForm action={closeSprint} className="mt-4 space-y-2 border-t border-slate-200 pt-4" resetOnSuccess={false}>
                <input type="hidden" name="id" value={s.id} />
                <Field label="Unfinished stories and bugs go to" hint="Finished tasks stay in this sprint.">
                  <Select name="carryTo" defaultValue="">
                    <option value="">Back to the backlog</option>
                    {otherOpen.map((x) => <option key={x.id} value={x.id}>{x.name} ({formatDate(x.start)})</option>)}
                  </Select>
                </Field>
                <SubmitButton variant="secondary" className="w-full">Close sprint</SubmitButton>
              </ActionForm>
            )}

            {s.state === "CLOSED" && (
              <p className="text-sm text-slate-600">
                Closed {s.closedAt ? formatDate(s.closedAt) : ""}. Carried over: {sum.carriedOverItems} of {sum.committedItems} committed item(s).
              </p>
            )}

            {s.state === "PLANNED" && (
              <div className="mt-4 border-t border-slate-200 pt-4">
                <DeleteButton action={deleteSprint} id={s.id} label="Delete sprint" confirmText={`Delete ${s.name}? Its items go back to the backlog.`} />
              </div>
            )}
          </Card>
          </EditOnly>
          {s.state === "CLOSED" && !edit && (
            <Card title="Sprint status">
              <p className="text-sm text-slate-600">
                Closed {s.closedAt ? formatDate(s.closedAt) : ""}. Carried over: {sum.carriedOverItems} of {sum.committedItems} committed item(s).
              </p>
            </Card>
          )}

          <EditOnly>
          <div id="edit" className="scroll-mt-4">
            <Card title="Edit sprint">
              <ActionForm action={updateSprint} className="space-y-3" successMessage="Saved." resetOnSuccess={false}>
                <input type="hidden" name="id" value={s.id} />
                <Field label="Name"><Input name="name" required maxLength={100} defaultValue={s.name} /></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Start"><Input type="date" name="startDate" required defaultValue={toISODate(s.start)} readOnly={s.state === "CLOSED"} /></Field>
                  <Field label="End"><Input type="date" name="endDate" required defaultValue={toISODate(s.end)} readOnly={s.state === "CLOSED"} /></Field>
                </div>
                <Field label="Goal"><Textarea name="goal" maxLength={1000} defaultValue={s.goal} /></Field>
                <Field label="Release">
                  <Select name="releaseId" defaultValue={s.releaseId ?? ""}>
                    <option value="">No release</option>
                    {releases.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </Select>
                </Field>
                {s.state === "CLOSED" ? (
                  <p className="text-xs text-slate-500">A closed sprint keeps its dates because its results are saved. You can still change its name, goal and release.</p>
                ) : s.state !== "PLANNED" ? (
                  <p className="text-xs text-slate-500">Moving the dates of a running sprint does not change the capacity taken from the planning sheet.</p>
                ) : null}
                <SubmitButton variant="secondary">Save changes</SubmitButton>
              </ActionForm>
            </Card>
          </div>
          </EditOnly>

          {s.pauses.length > 0 && (
            <Card title={`Pauses (${s.pauses.length})`}>
              <ul className="space-y-3 text-sm">
                {s.pauses.map((p) => (
                  <li key={p.id} className="border-l-2 border-amber-300 pl-3">
                    <div className="font-medium text-slate-800">
                      {formatDate(p.start)} → {p.resumedOn ? formatDate(p.resumedOn) : "still paused"}
                    </div>
                    <div className="text-xs text-slate-500">
                      {p.workingDays} working day(s){p.extendedByDays > 0 ? `, end date moved out by ${p.extendedByDays}` : p.resumedOn ? ", end date not moved" : ""}
                    </div>
                    {p.reason && <div className="text-slate-600">{p.reason}</div>}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>

      <Card title="Capacity and load" className="mt-6">
        {rows.length === 0 ? (
          <Empty>No members have hours in {s.squadName}. Add members on the Members page.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Member</Th>
                <Th className="text-right">Capacity</Th>
                <Th className="text-right">Assigned</Th>
                <Th className="text-right">Remaining</Th>
                <Th>Load</Th>
                <Th className="text-right">Done</Th>
                {editable && <Th>Share while overlapping</Th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id}>
                  <Td>
                    {r.name}
                    {r.plan && (
                      <div className="text-xs text-slate-500">
                        Initial {fmtH(r.plan.initial)} − meetings {fmtH(r.plan.meetings)} − vacation {fmtH(r.plan.vacation)} − other {fmtH(r.plan.other + r.plan.excuses)}
                      </div>
                    )}
                  </Td>
                  <Td className="text-right">{fmtH(r.capacity)}</Td>
                  <Td className="text-right">{fmtH(r.assigned)}</Td>
                  <Td className={r.assigned > r.capacity + 0.01 ? "text-right font-medium text-red-700" : "text-right"}>{fmtH(Math.round((r.capacity - r.assigned) * 100) / 100)}</Td>
                  <Td><LoadBar assigned={r.assigned} capacity={r.capacity} /></Td>
                  <Td className="text-right">{fmtH(r.done)}</Td>
                  {editable && (
                    <Td>
                      <ActionForm action={saveSprintShare} className="flex items-center gap-1" resetOnSuccess={false}>
                        <input type="hidden" name="sprintId" value={s.id} />
                        <input type="hidden" name="memberId" value={r.id} />
                        <Input type="number" name="percent" min="0" max="100" step="5" placeholder="auto" defaultValue={s.overrides[r.id] ?? ""} className="w-20 py-1 text-xs" aria-label={`Percent of ${r.name}'s hours for this sprint`} />
                        <span className="text-xs text-slate-500">%</span>
                        <SubmitButton variant="secondary" className="px-2 py-1 text-xs">Set</SubmitButton>
                      </ActionForm>
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <div className="mt-3 space-y-1 text-xs text-slate-500">
          <p>
            Capacity = the member&apos;s hours for this line of business (hours reserved for it, plus its share of the squad&apos;s unreserved hours) after weekends, holidays and leave.
            For members taken from the sprint planning sheet, capacity is the sheet&apos;s Final Buffer: initial hours minus meetings, vacation and other fixed work. Remaining = capacity − assigned.
          </p>
          {overlapping.length > 0 ? (
            <p className="text-amber-700">
              Overlaps with {overlapping.map((o) => o.name).join(", ")}: on shared days each sprint gets an equal share of a member&apos;s hours unless you set a percent above.
              {sum.overAllocated && " Some shares add up to more than 100%."}
            </p>
          ) : (
            <p>No other sprint of this squad overlaps, so the sprint gets all of each member&apos;s hours.</p>
          )}
        </div>
      </Card>
    </>
  );
}
