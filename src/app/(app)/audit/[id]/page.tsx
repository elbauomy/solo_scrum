import { notFound } from "next/navigation";
import { requirePageAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { AUDIT_ACTIONS, formatCairo, type AuditAction } from "@/lib/audit-entry";
import { Card, LinkButton, PageHeader, Table, Td, Th } from "@/components/ui";

const show = (v: unknown) => (v === undefined ? "—" : v === null || v === "" ? "(empty)" : typeof v === "object" ? JSON.stringify(v) : String(v));

export default async function AuditEntryPage({ params }: PageProps<"/audit/[id]">) {
  await requirePageAccess("audit.view");
  const { id } = await params;
  const e = await db.auditLog.findUnique({ where: { id } });
  if (!e) notFound();
  let details: unknown = null;
  try {
    details = e.details ? JSON.parse(e.details) : null;
  } catch {
    details = e.details;
  }
  const d = details && typeof details === "object" ? (details as Record<string, unknown>) : null;
  const before = d && d.before && typeof d.before === "object" ? (d.before as Record<string, unknown>) : null;
  const after = d && d.after && typeof d.after === "object" ? (d.after as Record<string, unknown>) : null;
  const rest = d ? Object.fromEntries(Object.entries(d).filter(([k]) => k !== "before" && k !== "after")) : null;
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];

  return (
    <>
      <PageHeader title={AUDIT_ACTIONS[e.action as AuditAction] ?? e.action} description={`${formatCairo(e.at)} (Cairo time)`} actions={<LinkButton href="/audit">← Audit log</LinkButton>} />
      <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
        <Card title="Entry">
          <dl className="grid grid-cols-[7rem_1fr] gap-y-2 text-sm">
            <dt className="text-slate-500">Action code</dt><dd className="font-mono text-xs leading-6">{e.action}</dd>
            <dt className="text-slate-500">User</dt><dd>{e.userName ?? "—"}</dd>
            {e.typedUsername != null && (<><dt className="text-slate-500">Typed name</dt><dd className="font-mono text-xs leading-6">{e.typedUsername || "(empty)"}</dd></>)}
            <dt className="text-slate-500">Record</dt><dd>{e.recordType ? `${e.recordType}${e.recordName ? `: ${e.recordName}` : ""}` : "—"}</dd>
            {e.recordId && (<><dt className="text-slate-500">Record ID</dt><dd className="break-all font-mono text-xs leading-6">{e.recordId}</dd></>)}
            <dt className="text-slate-500">IP address</dt><dd className="font-mono text-xs leading-6">{e.ip ?? "—"}</dd>
          </dl>
        </Card>
        <div className="space-y-6">
          {keys.length > 0 && (
            <Card title="Changes">
              <Table>
                <thead><tr><Th>Field</Th><Th>Before</Th><Th>After</Th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {keys.map((k) => (
                    <tr key={k}>
                      <Td className="font-medium">{k}</Td>
                      <Td className="break-all text-slate-600">{show(before?.[k])}</Td>
                      <Td className="break-all">{show(after?.[k])}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}
          {rest && Object.keys(rest).length > 0 && (
            <Card title="Details">
              <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-slate-50 p-3 text-xs text-slate-700">{JSON.stringify(rest, null, 2)}</pre>
            </Card>
          )}
          {!d && details != null && (
            <Card title="Details"><pre className="whitespace-pre-wrap break-all text-xs">{String(details)}</pre></Card>
          )}
        </div>
      </div>
    </>
  );
}
