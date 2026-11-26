import Link from "next/link";
import { requirePageAccess } from "@/lib/auth";
import { db } from "@/lib/db";
import { AUDIT_ACTIONS, AUDIT_ACTION_CODES, AUDIT_PAGE_SIZE, auditQuery, formatCairo, type AuditAction, type AuditFilters } from "@/lib/audit-entry";
import { Badge, Card, Empty, PageHeader, Table, Td, Th } from "@/components/ui";

const tone = (a: string): "red" | "amber" | "green" | "slate" =>
  a === "SIGN_IN_FAILED" || a === "ACCOUNT_LOCKED" || a === "TEAMS_FETCH_FAILED" ? "red" : a.endsWith("DELETED") || a === "BULK_DELETE" ? "amber" : a === "SIGN_IN_SUCCESS" ? "green" : "slate";

export default async function AuditPage({ searchParams }: PageProps<"/audit">) {
  await requirePageAccess("audit.view");
  const f = (await searchParams) as AuditFilters;
  const q = auditQuery(f);
  const [rows, total, users] = await Promise.all([
    db.auditLog.findMany({ where: q.where, orderBy: [{ at: "desc" }, { id: "desc" }], skip: (q.page - 1) * AUDIT_PAGE_SIZE, take: AUDIT_PAGE_SIZE }),
    db.auditLog.count({ where: q.where }),
    db.user.findMany({ orderBy: { displayName: "asc" }, select: { id: true, displayName: true } }),
  ]);
  const pages = Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE));
  const link = (page: number) => {
    const p = new URLSearchParams({ from: q.from, to: q.to, ...(f.user ? { user: f.user } : {}), ...(f.action ? { action: f.action } : {}), page: String(page) });
    return `/audit?${p}`;
  };
  const exportHref = `/api/export/audit?${new URLSearchParams({ from: q.from, to: q.to, ...(f.user ? { user: f.user } : {}), ...(f.action ? { action: f.action } : {}) })}`;

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Sign-ins, user and role changes, settings, backups and imports. Entries cannot be changed or deleted. Times are Cairo time."
        actions={<a href={exportHref} className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50">Export to Excel</a>}
      />
      <Card className="mb-6">
        <form className="flex flex-wrap items-end gap-3 text-sm">
          <label className="space-y-1"><span className="block text-xs font-medium text-slate-600">From</span>
            <input type="date" name="from" defaultValue={q.from} className="rounded-md border border-slate-300 px-2 py-1.5" />
          </label>
          <label className="space-y-1"><span className="block text-xs font-medium text-slate-600">To</span>
            <input type="date" name="to" defaultValue={q.to} className="rounded-md border border-slate-300 px-2 py-1.5" />
          </label>
          <label className="space-y-1"><span className="block text-xs font-medium text-slate-600">User</span>
            <select name="user" defaultValue={f.user ?? ""} className="rounded-md border border-slate-300 px-2 py-1.5">
              <option value="">Anyone</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
            </select>
          </label>
          <label className="space-y-1"><span className="block text-xs font-medium text-slate-600">Action</span>
            <select name="action" defaultValue={f.action ?? ""} className="rounded-md border border-slate-300 px-2 py-1.5">
              <option value="">Any action</option>
              {AUDIT_ACTION_CODES.map((a) => <option key={a} value={a}>{AUDIT_ACTIONS[a]}</option>)}
            </select>
          </label>
          <button className="rounded-lg bg-orange-500 px-3.5 py-1.5 font-semibold text-neutral-950">Apply</button>
          <Link href="/audit" className="px-2 py-1.5 text-slate-600 hover:text-slate-900">Clear</Link>
        </form>
      </Card>
      <Card title={`Entries (${total})`}>
        {rows.length === 0 ? (
          <Empty>Nothing was recorded for these filters.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>User</Th>
                <Th>Action</Th>
                <Th>Record</Th>
                <Th>IP address</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id}>
                  <Td className="whitespace-nowrap"><Link href={`/audit/${r.id}`} className="text-orange-700 hover:underline">{formatCairo(r.at)}</Link></Td>
                  <Td>{r.userName ?? (r.typedUsername != null ? <span className="text-slate-500">Typed: <span className="font-mono text-xs">{r.typedUsername || "(empty)"}</span></span> : <span className="text-slate-400">—</span>)}</Td>
                  <Td><Badge tone={tone(r.action)}>{AUDIT_ACTIONS[r.action as AuditAction] ?? r.action}</Badge></Td>
                  <Td>{r.recordType ? <span>{r.recordType}{r.recordName ? `: ${r.recordName}` : ""}</span> : <span className="text-slate-400">—</span>}</Td>
                  <Td className="font-mono text-xs">{r.ip ?? "—"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {pages > 1 && (
          <div className="mt-4 flex items-center justify-between text-sm">
            {q.page > 1 ? <Link href={link(q.page - 1)} className="text-orange-700 hover:underline">← Newer</Link> : <span />}
            <span className="text-slate-500">Page {q.page} of {pages}</span>
            {q.page < pages ? <Link href={link(q.page + 1)} className="text-orange-700 hover:underline">Older →</Link> : <span />}
          </div>
        )}
      </Card>
    </>
  );
}
