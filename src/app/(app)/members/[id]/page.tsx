import Link from "next/link";
import { requirePageAccess } from "@/lib/auth";
import { RoleProvider } from "@/components/role-provider";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getSettings, getWorkCalendar } from "@/lib/settings";
import { capacityBetween } from "@/lib/capacity";
import { addDays, formatDate, startOfWeek, todayUTC, toISODate } from "@/lib/dates";
import {
  addLeave,
  deleteLeave,
  deleteMember,
  removeMembership,
  saveMembership,
  updateMember,
} from "@/lib/actions/members";
import { ActionForm, DeleteButton, SubmitButton } from "@/components/ui/forms";
import { LobSplitForm } from "@/components/lob-split-form";
import { Badge, Card, Empty, Field, Input, LinkButton, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { Can } from "@/components/edit-only";

const WEEKS_AHEAD = 4;

export default async function MemberPage({ params }: PageProps<"/members/[id]">) {
  const me = await requirePageAccess("members.view");
  const { id } = await params;
  const [member, squads, settings, cal] = await Promise.all([
    db.member.findUnique({
      where: { id },
      include: {
        memberships: { include: { squad: { include: { lobs: { orderBy: { name: "asc" } } } }, lobAllocations: true }, orderBy: { squad: { name: "asc" } } },
        leaves: { orderBy: { startDate: "desc" } },
        user: { select: { id: true, username: true, active: true, role: { select: { name: true } } } },
      },
    }),
    db.squad.findMany({ orderBy: { name: "asc" } }),
    getSettings(),
    getWorkCalendar(),
  ]);
  if (!member) notFound();

  const today = todayUTC();
  const available = squads.filter((s) => !member.memberships.some((m) => m.squadId === s.id));
  const weeks = Array.from({ length: WEEKS_AHEAD }, (_, i) => {
    const start = addDays(startOfWeek(today, 0), i * 7);
    return { start, end: addDays(start, 6) };
  });
  const suggestedWeekly = settings.defaultDailyHours * settings.workingDays.length;

  return (
    <RoleProvider readOnly={!me.permissions.has("members.manage")}>
    <>
      <PageHeader
        title={member.name}
        description={member.role || "Member"}
        actions={<LinkButton href="/members">← Back to members</LinkButton>}
      />

      <div className="grid gap-6 xl:grid-cols-[22rem_1fr]">
        <div className="space-y-6">
          <Card title="Details">
            <ActionForm action={updateMember} className="space-y-3" successMessage="Saved." resetOnSuccess={false}>
              <input type="hidden" name="id" value={member.id} />
              <Field label="Name">
                <Input name="name" required maxLength={100} defaultValue={member.name} />
              </Field>
              <Field label="Role">
                <Input name="role" maxLength={100} defaultValue={member.role} />
              </Field>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" name="active" defaultChecked={member.active} />
                Active (inactive members are hidden from planning)
              </label>
              <SubmitButton>Save changes</SubmitButton>
            </ActionForm>
            <div className="mt-6 border-t border-slate-200 pt-4">
              <DeleteButton
                action={deleteMember}
                id={member.id}
                label="Delete member"
                confirmText={`Delete ${member.name}? Their squad hours and leave will also be removed.`}
              />
            </div>
          </Card>

          {me.permissions.has("users.manage") && (
            <Card title="Sign-in access">
              {member.user ? (
                <p className="text-sm text-slate-600">
                  Signs in as <span className="font-mono text-xs">{member.user.username}</span> with the role <strong>{member.user.role.name}</strong>
                  {!member.user.active && " (disabled)"}. <Link href={`/users/${member.user.id}`} className="font-medium text-orange-700 hover:underline">Manage account</Link>
                </p>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-slate-600">{member.name} cannot sign in yet.</p>
                  <LinkButton href={`/users?member=${member.id}`} variant="primary">Give sign-in access</LinkButton>
                </div>
              )}
            </Card>
          )}

          <Can perm="members.manage">
          <Card title="Add leave">
            <ActionForm action={addLeave} className="space-y-3" successMessage="Leave added.">
              <input type="hidden" name="memberId" value={member.id} />
              <div className="grid grid-cols-2 gap-3">
                <Field label="From">
                  <Input type="date" name="startDate" required defaultValue={toISODate(today)} />
                </Field>
                <Field label="To (inclusive)">
                  <Input type="date" name="endDate" required defaultValue={toISODate(today)} />
                </Field>
              </div>
              <Field label="Note">
                <Input name="note" maxLength={200} placeholder="e.g. Annual leave" />
              </Field>
              <SubmitButton>Add leave</SubmitButton>
            </ActionForm>
          </Card>
          </Can>
        </div>

        <div className="space-y-6">
          <Card title="Squads and hours per week">
            {member.memberships.length === 0 ? (
              <Empty>Not in any squad yet.</Empty>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Squad</Th>
                    <Th>Hours / week</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {member.memberships.map((ms) => (
                    <tr key={ms.id}>
                      <Td>
                        <Link href={`/squads/${ms.squad.id}`} className="font-medium text-orange-700 hover:underline">{ms.squad.name}</Link>
                      </Td>
                      <Td>
                        <ActionForm action={saveMembership} className="flex items-center gap-2" resetOnSuccess={false}>
                          <input type="hidden" name="memberId" value={member.id} />
                          <input type="hidden" name="squadId" value={ms.squadId} />
                          <Input type="number" name="weeklyHours" step="0.5" min="0" max="168" defaultValue={ms.weeklyHours} className="w-24" aria-label={`Hours per week in ${ms.squad.name}`} />
                          <SubmitButton variant="secondary" className="px-2 py-1 text-xs">Update</SubmitButton>
                        </ActionForm>
                      </Td>
                      <Td className="text-right">
                        <DeleteButton action={removeMembership} id={ms.id} label="Remove" confirmText={`Remove ${member.name} from ${ms.squad.name}?`} />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
            {available.length > 0 && (
              <Can perm="members.manage">
              <ActionForm action={saveMembership} className="mt-4 grid gap-3 border-t border-slate-200 pt-4 sm:grid-cols-[1fr_8rem_auto] sm:items-end">
                <input type="hidden" name="memberId" value={member.id} />
                <Field label="Add to squad">
                  <Select name="squadId" required defaultValue="">
                    <option value="" disabled>Choose…</option>
                    {available.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Hours / week">
                  <Input type="number" name="weeklyHours" step="0.5" min="0" max="168" defaultValue={suggestedWeekly} required />
                </Field>
                <SubmitButton>Add</SubmitButton>
              </ActionForm>
              </Can>
            )}
          </Card>

          {member.memberships.some((ms) => ms.squad.lobs.length > 0) && (
            <Card title="Split across lines of business">
              <p className="mb-4 text-sm text-slate-500">
                Optional. A supervisor who shares time between several lines of business can reserve hours for each. Hours you don&apos;t reserve stay shared by all of the squad&apos;s lines,
                split by the sprints that overlap. A reserved line only gives its hours to its own sprints, tasks and timeline.
              </p>
              <div className="space-y-6">
                {member.memberships.filter((ms) => ms.squad.lobs.length > 0).map((ms) => (
                  <div key={ms.id} className="border-t border-slate-200 pt-4 first:border-0 first:pt-0">
                    <LobSplitForm
                      membershipId={ms.id}
                      squadName={ms.squad.name}
                      weeklyHours={ms.weeklyHours}
                      lobs={ms.squad.lobs.map((l) => ({ id: l.id, key: l.key, name: l.name, hours: ms.lobAllocations.find((a) => a.lobId === l.id)?.weeklyHours ?? null }))}
                    />
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card title={`Available hours — next ${WEEKS_AHEAD} weeks`}>
            {member.memberships.length === 0 ? (
              <Empty>Add the member to a squad to see capacity.</Empty>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Squad</Th>
                    {weeks.map((w) => (
                      <Th key={w.start.toISOString()}>Week of {formatDate(w.start)}</Th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {member.memberships.map((ms) => (
                    <tr key={ms.id}>
                      <Td>{ms.squad.name}</Td>
                      {weeks.map((w) => (
                        <Td key={w.start.toISOString()}>
                          {member.active ? `${capacityBetween(w.start, w.end, ms.weeklyHours, cal, member.leaves)} h` : "—"}
                        </Td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
            <p className="mt-2 text-xs text-slate-500">After weekends, public holidays and this member&apos;s leave.</p>
          </Card>

          <Card title="Leave">
            {member.leaves.length === 0 ? (
              <Empty>No leave recorded.</Empty>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>From</Th>
                    <Th>To</Th>
                    <Th>Note</Th>
                    <Th />
                    <Th />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {member.leaves.map((l) => {
                    const current = l.startDate <= today && l.endDate >= today;
                    const past = l.endDate < today;
                    return (
                      <tr key={l.id} className={past ? "text-slate-400" : undefined}>
                        <Td>{formatDate(l.startDate)}</Td>
                        <Td>{formatDate(l.endDate)}</Td>
                        <Td>{l.note || "—"}</Td>
                        <Td>{current ? <Badge tone="amber">Now</Badge> : past ? <Badge>Past</Badge> : <Badge tone="orange">Upcoming</Badge>}</Td>
                        <Td className="text-right">
                          <DeleteButton action={deleteLeave} id={l.id} confirmText="Delete this leave?" />
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Card>
        </div>
      </div>
    </>
    </RoleProvider>
  );
}
