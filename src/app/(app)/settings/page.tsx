import { db } from "@/lib/db";
import { requirePageAccess } from "@/lib/auth";
import { RoleProvider } from "@/components/role-provider";
import { getSettings } from "@/lib/settings";
import { WEEKDAYS, formatDate, toISODate } from "@/lib/dates";
import { addHoliday, deleteHoliday, updateSettings } from "@/lib/actions/settings";
import { ActionForm, DeleteButton, SubmitButton } from "@/components/ui/forms";
import { Card, Empty, Field, Input, PageHeader, Table, Td, Th } from "@/components/ui";
import { Can } from "@/components/edit-only";

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const me = await requirePageAccess("settings.view");
  const { year } = (await searchParams) as { year?: string };
  const [settings, holidays] = await Promise.all([
    getSettings(),
    db.holiday.findMany({ orderBy: { date: "asc" } }),
  ]);
  const years = [...new Set(holidays.map((h) => h.date.getUTCFullYear()))].sort();
  const shown = year ? holidays.filter((h) => String(h.date.getUTCFullYear()) === year) : holidays;

  return (
    <RoleProvider readOnly={!me.permissions.has("settings.manage")}>
    <>
      <PageHeader title="Settings" description="Working calendar and defaults used for capacity and sprint planning." />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Working calendar">
          <ActionForm action={updateSettings} className="space-y-4" successMessage="Settings saved." resetOnSuccess={false}>
            <div>
              <span className="text-sm font-medium text-slate-700">Working days</span>
              <div className="mt-2 flex flex-wrap gap-2">
                {WEEKDAYS.map((day, i) => (
                  <label key={day} className="flex items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm">
                    <input type="checkbox" name="workingDays" value={i} defaultChecked={settings.workingDays.includes(i)} />
                    {day.slice(0, 3)}
                  </label>
                ))}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Default working hours per day" hint="Used to suggest a member's weekly hours.">
                <Input type="number" name="defaultDailyHours" step="0.5" min="0.5" max="24" defaultValue={settings.defaultDailyHours} required />
              </Field>
              <Field label="Default sprint length (days)" hint="Squads and LOBs can override this.">
                <Input type="number" name="defaultSprintLengthDays" min="1" max="365" defaultValue={settings.defaultSprintLengthDays} required />
              </Field>
            </div>
            <SubmitButton>Save settings</SubmitButton>
          </ActionForm>
        </Card>

        <Card title="Public holidays">
          <Can perm="settings.manage">
          <ActionForm action={addHoliday} className="mb-4 grid gap-3 sm:grid-cols-[10rem_1fr_auto] sm:items-end">
            <Field label="Date">
              <Input type="date" name="date" required />
            </Field>
            <Field label="Name">
              <Input name="name" placeholder="e.g. National Day" required />
            </Field>
            <SubmitButton>Add</SubmitButton>
          </ActionForm>
          </Can>

          {years.length > 1 && (
            <form className="mb-3 flex items-center gap-2 text-sm">
              <span className="text-slate-500">Year:</span>
              <select name="year" defaultValue={year ?? ""} className="rounded-md border border-slate-300 px-2 py-1">
                <option value="">All</option>
                {years.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
              <button className="rounded-md border border-slate-300 px-2 py-1">Filter</button>
            </form>
          )}

          {shown.length === 0 ? (
            <Empty>No holidays added.</Empty>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Day</Th>
                  <Th>Name</Th>
                  <Th />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shown.map((h) => (
                  <tr key={h.id}>
                    <Td>
                      <time dateTime={toISODate(h.date)}>{formatDate(h.date)}</time>
                    </Td>
                    <Td>{WEEKDAYS[h.date.getUTCDay()]}</Td>
                    <Td>{h.name}</Td>
                    <Td className="text-right">
                      <DeleteButton action={deleteHoliday} id={h.id} confirmText={`Delete holiday "${h.name}"?`} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
    </RoleProvider>
  );
}
