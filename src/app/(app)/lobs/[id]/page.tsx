import { notFound } from "next/navigation";
import { requirePageAccess } from "@/lib/auth";
import { RoleProvider } from "@/components/role-provider";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { effectiveSprintLength } from "@/lib/capacity";
import { deleteLob, updateLob } from "@/lib/actions/lobs";
import { ActionForm, DeleteButton, SubmitButton } from "@/components/ui/forms";
import { Card, LinkButton, PageHeader } from "@/components/ui";
import { LobFields } from "@/components/entity-fields";

export default async function LobPage({ params }: PageProps<"/lobs/[id]">) {
  const me = await requirePageAccess("lobs.view");
  const { id } = await params;
  const [lob, squads, settings] = await Promise.all([
    db.lineOfBusiness.findUnique({ where: { id }, include: { squad: true } }),
    db.squad.findMany({ orderBy: { name: "asc" } }),
    getSettings(),
  ]);
  if (!lob) notFound();

  const sprint = effectiveSprintLength(lob.sprintLengthDays, lob.squad.sprintLengthDays, settings.defaultSprintLengthDays);

  return (
    <RoleProvider readOnly={!me.permissions.has("lobs.manage")}>
    <>
      <PageHeader
        title={lob.name}
        description={`Owned by ${lob.squad.name} · Sprint length ${sprint} days`}
        actions={<LinkButton href="/lobs">← Back to lines of business</LinkButton>}
      />
      <Card title="Edit line of business" className="max-w-xl">
        <ActionForm action={updateLob} className="space-y-3" resetOnSuccess={false}>
          <input type="hidden" name="id" value={lob.id} />
          <LobFields squads={squads} values={lob} />
          <SubmitButton>Save changes</SubmitButton>
        </ActionForm>
        <div className="mt-6 border-t border-slate-200 pt-4">
          <DeleteButton
            action={deleteLob}
            id={lob.id}
            label="Delete line of business"
            confirmText={`Delete "${lob.name}"? This cannot be undone.`}
          />
        </div>
      </Card>
    </>
    </RoleProvider>
  );
}
