import Link from "next/link";
import { requirePageAccess } from "@/lib/auth";
import { RoleProvider } from "@/components/role-provider";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { effectiveSprintLength } from "@/lib/capacity";
import { createLob } from "@/lib/actions/lobs";
import { ActionForm, SubmitButton } from "@/components/ui/forms";
import { Card, Empty, LinkButton, PageHeader, Table, Td, Th } from "@/components/ui";
import { LobFields } from "@/components/entity-fields";
import { Can } from "@/components/edit-only";

export default async function LobsPage({ searchParams }: PageProps<"/lobs">) {
  const me = await requirePageAccess("lobs.view");
  const { squad, q } = (await searchParams) as { squad?: string; q?: string };
  const [lobs, squads, settings] = await Promise.all([
    db.lineOfBusiness.findMany({
      where: {
        ...(squad ? { squadId: squad } : {}),
        ...(q ? { name: { contains: q, mode: "insensitive" as const } } : {}),
      },
      orderBy: { name: "asc" },
      include: { squad: true, _count: { select: { workItems: true } } },
    }),
    db.squad.findMany({ orderBy: { name: "asc" } }),
    getSettings(),
  ]);

  return (
    <RoleProvider readOnly={!me.permissions.has("lobs.manage")}>
    <>
      <PageHeader title="Lines of Business" description="Each line of business (project) is owned by one squad and has its own sprints and releases." />

      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <Card
          title={`Lines of Business (${lobs.length})`}
          actions={
            <form className="flex flex-wrap gap-2">
              <select name="squad" defaultValue={squad ?? ""} className="rounded-md border border-slate-300 px-2 py-1 text-sm">
                <option value="">All squads</option>
                {squads.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <input name="q" defaultValue={q} placeholder="Search…" className="w-36 rounded-md border border-slate-300 px-2 py-1 text-sm" />
              <button className="rounded-md border border-slate-300 px-2 py-1 text-sm">Filter</button>
            </form>
          }
        >
          {lobs.length === 0 ? (
            <Empty>{squad || q ? "Nothing matches these filters." : "No lines of business yet."}</Empty>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Code</Th>
                  <Th>Name</Th>
                  <Th>Squad</Th>
                  <Th>Items</Th>
                  <Th>Sprint length</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lobs.map((l) => (
                  <tr key={l.id}>
                    <Td className="font-mono text-xs font-semibold">{l.key}</Td>
                    <Td>
                      <Link href={`/lobs/${l.id}`} className="font-medium text-orange-700 hover:underline">{l.name}</Link>
                      {l.description && <div className="text-xs text-slate-500">{l.description}</div>}
                    </Td>
                    <Td>
                      <Link href={`/squads/${l.squad.id}`} className="hover:underline">{l.squad.name}</Link>
                    </Td>
                    <Td>
                      <Link href={`/backlog?lob=${l.id}`} className="hover:underline">{l._count.workItems}</Link>
                    </Td>
                    <Td>
                      {effectiveSprintLength(l.sprintLengthDays, l.squad.sprintLengthDays, settings.defaultSprintLengthDays)} days
                      {l.sprintLengthDays == null && (
                        <span className="text-xs text-slate-400">
                          {" "}({l.squad.sprintLengthDays == null ? "default" : "from squad"})
                        </span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Can perm="lobs.manage">
        <Card title="Add line of business">
          {squads.length === 0 ? (
            <Empty>
              Create a squad first. <LinkButton href="/squads" className="ml-1 px-2 py-1 text-xs">Go to squads</LinkButton>
            </Empty>
          ) : (
            <ActionForm action={createLob} className="space-y-3" successMessage="Line of business added.">
              <LobFields squads={squads} values={squad ? { name: "", description: "", squadId: squad, sprintLengthDays: null } : undefined} />
              <SubmitButton>Add line of business</SubmitButton>
            </ActionForm>
          )}
        </Card>
        </Can>
      </div>
    </>
    </RoleProvider>
  );
}
