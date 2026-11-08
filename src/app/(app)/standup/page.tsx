import Link from "next/link";
import { requirePageAccess } from "@/lib/auth";
import { RoleProvider } from "@/components/role-provider";
import { db } from "@/lib/db";
import { getWorkCalendar } from "@/lib/settings";
import { isWorkingDay } from "@/lib/capacity";
import { addDays, formatDate, todayUTC, toISODate, WEEKDAYS } from "@/lib/dates";
import { applyCls, dateParam, selectCls, toQuery } from "@/lib/filters";
import { itemKey } from "@/lib/work-items";
import { isStandupLeave } from "@/lib/standup";
import { AutoSubmitForm, LocalDateDefault, StandupMemberForm } from "@/components/standup-form";
import { Badge, Card, Empty, PageHeader, Table, Td, Th } from "@/components/ui";

type Q = { squad?: string; date?: string; member?: string; from?: string; to?: string; hsquad?: string; hmember?: string };

export default async function StandupPage({ searchParams }: PageProps<"/standup">) {
  const me = await requirePageAccess("standup.view");
  const f = (await searchParams) as Q;
  const [squads, cal] = await Promise.all([db.squad.findMany({ orderBy: { name: "asc" } }), getWorkCalendar()]);
  const squadId = f.squad || squads[0]?.id || "";
  const squad = squads.find((s) => s.id === squadId);
  const date = dateParam(f.date) ?? todayUTC();

  // Previous working day (suggestions look at what was finished since then).
  let prev = addDays(date, -1);
  for (let i = 0; i < 14 && !isWorkingDay(prev, cal); i++) prev = addDays(prev, -1);

  const squadMemberships = squad
    ? await db.squadMembership.findMany({
        where: { squadId, member: { active: true } },
        include: { member: true },
        orderBy: { member: { name: "asc" } },
      })
    : [];
  // A member filter that belongs to another squad is ignored, so changing the squad never leaves an empty page.
  const memberships = f.member && squadMemberships.some((m) => m.memberId === f.member) ? squadMemberships.filter((m) => m.memberId === f.member) : squadMemberships;
  const memberIds = memberships.map((m) => m.memberId);
  const [entries, tasks, leavesOn, offAnywhere] = await Promise.all([
    db.standupEntry.findMany({ where: { date, squadId, memberId: { in: memberIds } } }),
    db.workItem.findMany({
      where: {
        type: "TASK",
        assigneeId: { in: memberIds },
        lob: { squadId },
        OR: [{ status: "DONE", doneAt: { gte: prev, lt: date } }, { status: "IN_PROGRESS" }, { blocked: true, status: { not: "DONE" } }],
      },
      include: { lob: { select: { key: true } } },
      orderBy: [{ rank: "asc" }, { number: "asc" }],
    }),
    db.leave.findMany({ where: { memberId: { in: memberIds }, startDate: { lte: date }, endDate: { gte: date } } }),
    db.standupEntry.findMany({ where: { date, memberId: { in: memberIds }, off: true } }),
  ]);
  const entryOf = new Map(entries.map((e) => [e.memberId, e]));
  const offIds = new Set(offAnywhere.map((e) => e.memberId));
  const line = (t: (typeof tasks)[number]) => `${itemKey(t.lob.key, t.number)} ${t.title}${t.estimateHours != null ? ` (${t.estimateHours}h)` : ""}`;

  const cards = memberships.map(({ member }) => {
    const e = entryOf.get(member.id);
    const mine = tasks.filter((t) => t.assigneeId === member.id);
    const done = mine.filter((t) => t.status === "DONE").map(line);
    const doing = mine.filter((t) => t.status === "IN_PROGRESS").map(line);
    const suggestion = [done.length ? `Finished since ${formatDate(prev)}:\n- ${done.join("\n- ")}` : "", doing.length ? `In progress:\n- ${doing.join("\n- ")}` : ""].filter(Boolean).join("\n");
    const blockedList = mine.filter((t) => t.blocked).map((t) => `${line(t)}${t.blockedReason ? ` — ${t.blockedReason}` : ""}`).join("\n");
    // Notes saved in the earlier format (yesterday / today) are shown as one status until they are edited.
    const initialStatus = e ? e.status || [e.yesterday && `Yesterday: ${e.yesterday}`, e.today && `Today: ${e.today}`].filter(Boolean).join("\n") : "";
    // Leave on that day: added by this page (can be undone here) or on the member's own page (cannot)
    const mine2 = leavesOn.filter((l) => l.memberId === member.id);
    const sameDay = (l: (typeof leavesOn)[number]) => l.startDate.getTime() === date.getTime() && l.endDate.getTime() === date.getTime();
    const viaStandup = mine2.find((l) => sameDay(l) && isStandupLeave(l.note));
    const external = mine2.find((l) => !(sameDay(l) && isStandupLeave(l.note)));
    const off = Boolean(e?.off) || offIds.has(member.id) || Boolean(viaStandup) || Boolean(external);
    const leaveNote = external && !viaStandup && !e?.off && !offIds.has(member.id) ? external.note || "recorded as leave" : null;
    const standupLeaveReason = viaStandup ? viaStandup.note.replace(/^Off - daily standup:?\s*/, "") : "";
    return { member, e, off, leaveNote, suggestion, blockedList, initialStatus, standupLeaveReason };
  });
  const offCount = cards.filter((c) => c.off).length;
  const summary = (
    <p className="text-sm text-slate-600">
      {cards.length - offCount} present{offCount > 0 ? <> · <strong className="text-amber-800">{offCount} off</strong> ({cards.filter((c) => c.off).map((c) => c.member.name).join(", ")})</> : null}
    </p>
  );

  // History
  const hFrom = dateParam(f.from) ?? addDays(todayUTC(), -13);
  const hTo = dateParam(f.to) ?? (date.getTime() > todayUTC().getTime() ? date : todayUTC());
  const history = await db.standupEntry.findMany({
    where: { date: { gte: hFrom, lte: hTo }, ...(f.hsquad ? { squadId: f.hsquad } : {}), ...(f.hmember ? { memberId: f.hmember } : {}) },
    include: { squad: { select: { name: true } }, member: { select: { name: true } } },
    orderBy: [{ date: "desc" }, { squad: { name: "asc" } }, { member: { name: "asc" } }],
    take: 500,
  });
  const allMembers = await db.member.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
  const exportQuery = toQuery({ squad: f.hsquad, member: f.hmember, from: toISODate(hFrom), to: toISODate(hTo) });

  return (
    <RoleProvider readOnly={!me.permissions.has("standup.edit")}>
    <>
      <PageHeader title="Daily Standup" description="Choose the squad and the day, then type each person's status. Your notes are kept as history." />

      {!f.date && <LocalDateDefault serverDate={toISODate(date)} query={toQuery({ squad: f.squad, member: f.member })} />}
      <Card className="mb-4">
        <AutoSubmitForm className="flex flex-wrap items-end gap-3">
          <label className="space-y-1 text-xs font-medium text-slate-600">
            1. Squad
            <select name="squad" defaultValue={squadId} className={`${selectCls} block`} aria-label="Squad">
              {squads.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-xs font-medium text-slate-600">
            2. Date
            <input type="date" name="date" defaultValue={toISODate(date)} className={`${selectCls} block`} aria-label="Date" />
          </label>
          <label className="space-y-1 text-xs font-medium text-slate-600">
            Member (optional)
            <select name="member" defaultValue={f.member ?? ""} className={`${selectCls} block`} aria-label="Member">
              <option value="">All members</option>
              {squadMemberships.map((m) => <option key={m.memberId} value={m.memberId}>{m.member.name}</option>)}
            </select>
          </label>
          <noscript><button className={applyCls}>Show</button></noscript>
          <Link href={`/standup${toQuery({ squad: squadId })}`} className="pb-2 text-sm text-orange-700 hover:underline">Today</Link>
          <span className="pb-2 text-sm text-slate-500">{WEEKDAYS[date.getUTCDay()]}, {formatDate(date)}{!isWorkingDay(date, cal) && " (not a working day)"}</span>
        </AutoSubmitForm>
      </Card>

      {!squad ? (
        <Card><Empty>Create a squad and add members first.</Empty></Card>
      ) : memberships.length === 0 ? (
        <Card><Empty>No active members in {squad.name}. Add them on the Members page.</Empty></Card>
      ) : (
        <div className="space-y-4">
          {summary}
          {cards.map((c) => (
            <Card
              key={c.member.id}
              title={c.member.name}
              actions={
                <span className="flex items-center gap-2 text-xs text-slate-500">
                  {c.off && <Badge tone="amber">Off today</Badge>}
                  {c.e ? `Saved ${c.e.updatedAt.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}` : c.off ? "From leave" : "Not entered yet"}
                </span>
              }
            >
              <StandupMemberForm
                key={`${squadId}-${toISODate(date)}-${c.member.id}`}
                date={toISODate(date)}
                squadId={squadId}
                memberId={c.member.id}
                initialStatus={c.initialStatus}
                initialBlockers={c.e?.blockers ?? ""}
                suggestion={c.suggestion}
                blockerSuggestion={c.blockedList}
                initialOff={c.off}
                initialOffReason={c.e?.offReason ?? c.standupLeaveReason}
                leaveNote={c.leaveNote}
              />
            </Card>
          ))}
        </div>
      )}

      <Card
        title={`Standup history (${history.length})`}
        className="mt-6"
        actions={<a href={`/api/export/standup${exportQuery}`} className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">Export Excel</a>}
      >
        <form className="mb-4 flex flex-wrap items-end gap-2">
          <input type="hidden" name="squad" value={squadId} />
          <input type="hidden" name="date" value={toISODate(date)} />
          <select name="hsquad" defaultValue={f.hsquad ?? ""} className={selectCls} aria-label="History squad">
            <option value="">All squads</option>
            {squads.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select name="hmember" defaultValue={f.hmember ?? ""} className={selectCls} aria-label="History member">
            <option value="">All members</option>
            {allMembers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <input type="date" name="from" defaultValue={toISODate(hFrom)} className={selectCls} aria-label="History from" /> –
          <input type="date" name="to" defaultValue={toISODate(hTo)} className={selectCls} aria-label="History to" />
          <button className={applyCls}>Filter history</button>
        </form>
        {history.length === 0 ? (
          <Empty>No saved standups in this range.</Empty>
        ) : (
          <Table>
            <thead><tr><Th>Date</Th><Th>Squad</Th><Th>Member</Th><Th>Status</Th><Th>Blockers</Th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {history.map((h) => (
                <tr key={h.id} className="align-top">
                  <Td className="whitespace-nowrap"><Link className="hover:underline" href={`/standup${toQuery({ squad: h.squadId, date: toISODate(h.date) })}`}>{formatDate(h.date)}</Link></Td>
                  <Td>{h.squad.name}</Td>
                  <Td>{h.member.name}</Td>
                  <Td className="whitespace-pre-wrap text-xs">
                    {h.off ? <span className="font-medium text-amber-800">Off{h.offReason ? `: ${h.offReason}` : ""}</span> : h.status || [h.yesterday && `Yesterday: ${h.yesterday}`, h.today && `Today: ${h.today}`].filter(Boolean).join("\n") || "—"}
                  </Td>
                  <Td className={`whitespace-pre-wrap text-xs ${h.blockers ? "text-red-700" : ""}`}>{h.blockers || "—"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
    </RoleProvider>
  );
}
