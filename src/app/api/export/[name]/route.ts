import { NextResponse, type NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { AUDIT_ACTIONS, auditQuery, formatCairo, type AuditAction, type AuditFilters } from "@/lib/audit-entry";
import { db } from "@/lib/db";
import { loadAnalytics } from "@/lib/analytics";
import { loadBacklog, type BacklogFilters } from "@/lib/backlog";
import { buildBackupSheets } from "@/lib/backup";
import { buildWorkbook, type Sheet } from "@/lib/excel";
import { dateParam } from "@/lib/filters";
import { addDays, formatDate, toISODate, todayUTC } from "@/lib/dates";
import { buildReports, REPORTS, type ReportFilters } from "@/lib/reports";
import { filterTimeline } from "@/lib/timeline-filter";
import { loadDailyPlan, type DailyFilters } from "@/lib/daily-plan-data";
import { WEEKDAYS } from "@/lib/dates";
import { importTemplateSheets } from "@/lib/import";
import { PRIORITY_LABEL, STATUS_LABEL, TYPE_LABEL } from "@/lib/work-items";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function params(req: NextRequest): Record<string, string> {
  return Object.fromEntries(req.nextUrl.searchParams.entries());
}

function file(buffer: Buffer, name: string) {
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": XLSX,
      "Content-Disposition": `attachment; filename="solo-scrum-${name}-${toISODate(todayUTC())}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ name: string }> }) {
  const me = await requireSession();
  const { name } = await ctx.params;
  // Each download needs the permission of the page it comes from.
  const needed: Record<string, string[]> = {
    report: ["reports.export"],
    backlog: ["backlog.view"],
    timeline: ["timeline.view"],
    "daily-plan": ["timeline.view"],
    standup: ["standup.view"],
    backup: ["data.backup"],
    template: ["data.import"],
    audit: ["audit.view"],
  };
  if (!(needed[name] ?? []).some((p) => me.permissions.has(p))) {
    return NextResponse.json({ error: "Your role does not allow this download." }, { status: 403 });
  }
  const q = params(req);

  switch (name) {
    case "report": {
      const bundle = await buildReports(q as ReportFilters);
      const wanted = q.report && q.report !== "all" ? [q.report] : REPORTS.map((r) => r.id);
      const sheets: Sheet[] = wanted.flatMap((id) => {
        const t = bundle.tables[id];
        return t ? [{ title: t.title, columns: t.columns, rows: t.rows, note: t.description }] : [];
      });
      if (sheets.length === 0) return NextResponse.json({ error: "Unknown report" }, { status: 404 });
      return file(await buildWorkbook(sheets), q.report && q.report !== "all" ? q.report : "reports");
    }

    case "backlog": {
      const groups = await loadBacklog(q as BacklogFilters);
      const rows = groups.flatMap((g) =>
        g.rows
          .filter((r) => r.matched)
          .map((r) => ({
            lob: `${g.lob.key} · ${g.lob.name}`, id: r.key, type: TYPE_LABEL[r.type], title: r.title,
            status: r.type === "EPIC" || r.type === "FEATURE" ? "" : STATUS_LABEL[r.status], priority: PRIORITY_LABEL[r.priority],
            assignee: r.assigneeName ?? "", estimate: r.type === "TASK" ? r.estimateHours : null, total: r.totalHours, done: r.doneHours,
            progress: r.progress, blocked: r.blocked ? r.blockedReason || "Yes" : "",
          })),
      );
      return file(
        await buildWorkbook([{
          title: "Backlog",
          columns: [
            { key: "lob", label: "Line of Business" }, { key: "id", label: "ID" }, { key: "type", label: "Type" }, { key: "title", label: "Title" },
            { key: "status", label: "Status" }, { key: "priority", label: "Priority" }, { key: "assignee", label: "Assignee" },
            { key: "estimate", label: "Estimate h", numeric: true }, { key: "total", label: "Total task h", numeric: true }, { key: "done", label: "Done task h", numeric: true },
            { key: "progress", label: "Progress %", numeric: true }, { key: "blocked", label: "Blocked" },
          ],
          rows,
        }]),
        "backlog",
      );
    }

    case "timeline": {
      const a = await loadAnalytics();
      const { tasks } = filterTimeline(a, q);
      const rows = tasks.map((t) => ({
        task: t.key, title: t.title, story: t.storyKey ? `${t.storyKey} ${t.storyTitle}` : "", sprint: t.sprintName, assignee: t.assigneeName ?? "", hours: t.hours,
        start: t.plan?.start ? toISODate(t.plan.start) : "", end: t.plan?.end ? toISODate(t.plan.end) : "", deadline: toISODate(t.deadline),
        status: t.issue ? t.issue.replace("-", " ") : t.slipped ? "slipped" : t.plan?.end ? "on track" : "not scheduled",
      }));
      return file(
        await buildWorkbook([{
          title: "Timeline",
          note: "Planned dates from each member's availability. A task slips when it ends after its deadline (the sprint end or the accepted baseline).",
          columns: [
            { key: "task", label: "Task" }, { key: "title", label: "Title" }, { key: "story", label: "Story / bug" }, { key: "sprint", label: "Sprint" }, { key: "assignee", label: "Assignee" },
            { key: "hours", label: "Hours", numeric: true }, { key: "start", label: "Planned start" }, { key: "end", label: "Planned end" }, { key: "deadline", label: "Deadline" }, { key: "status", label: "Status" },
          ],
          rows,
        }]),
        "timeline",
      );
    }

    case "daily-plan": {
      const { rows } = await loadDailyPlan(q as DailyFilters);
      const out = rows.flatMap((m) =>
        m.days.flatMap((c) =>
          c.stories.flatMap((st) =>
            st.items.map((i) => ({
              date: c.iso, day: WEEKDAYS[new Date(`${c.iso}T00:00:00Z`).getUTCDay()], member: m.name,
              story: st.storyKey ? `${st.storyKey} ${st.storyTitle}` : "", task: `${i.key} ${i.title}`, hours: i.done ? null : i.hours, total: i.totalHours,
              status: i.done ? "finished that day" : i.status === "IN_PROGRESS" ? "in progress" : "planned", blocked: i.blocked ? "yes" : "", sprint: i.sprintName,
            })),
          ),
        ),
      );
      return file(
        await buildWorkbook([{
          title: "Daily plan",
          note: "What each team member works on each day, planned from task hours and availability.",
          columns: [
            { key: "date", label: "Date" }, { key: "day", label: "Day" }, { key: "member", label: "Member" }, { key: "story", label: "User story" }, { key: "task", label: "Task" },
            { key: "hours", label: "Hours that day", numeric: true }, { key: "total", label: "Task estimate h", numeric: true }, { key: "status", label: "Status" }, { key: "blocked", label: "Blocked" }, { key: "sprint", label: "Sprint" },
          ],
          rows: out,
        }]),
        "daily-plan",
      );
    }

    case "standup": {
      const from = dateParam(q.from) ?? addDays(todayUTC(), -13);
      const to = dateParam(q.to) ?? todayUTC();
      const entries = await db.standupEntry.findMany({
        where: { date: { gte: from, lte: to }, ...(q.squad ? { squadId: q.squad } : {}), ...(q.member ? { memberId: q.member } : {}) },
        include: { squad: { select: { name: true } }, member: { select: { name: true } } },
        orderBy: [{ date: "desc" }, { squad: { name: "asc" } }, { member: { name: "asc" } }],
      });
      return file(
        await buildWorkbook([{
          title: "Standup",
          note: `Daily standup notes ${formatDate(from)} – ${formatDate(to)}`,
          columns: [{ key: "date", label: "Date" }, { key: "squad", label: "Squad" }, { key: "member", label: "Member" }, { key: "status", label: "Status" }, { key: "blockers", label: "Blockers" }],
          rows: entries.map((e) => ({ date: toISODate(e.date), squad: e.squad.name, member: e.member.name, status: e.off ? `OFF${e.offReason ? `: ${e.offReason}` : ""}` : e.status || [e.yesterday && `Yesterday: ${e.yesterday}`, e.today && `Today: ${e.today}`].filter(Boolean).join("\n"), blockers: e.blockers })),
        }]),
        "standup",
      );
    }

    case "backup": {
      const book = await buildWorkbook(await buildBackupSheets());
      await recordAudit({ action: "BACKUP_DOWNLOADED", user: me, record: { type: "Backup" } });
      return file(book, "backup");
    }

    case "audit": {
      const aq = auditQuery(q as AuditFilters);
      const rows = await db.auditLog.findMany({ where: aq.where, orderBy: [{ at: "desc" }, { id: "desc" }], take: 50_000 });
      const sheet: Sheet = {
        title: "Audit log",
        note: `Cairo time, ${aq.from} to ${aq.to}`,
        columns: [
          { key: "when", label: "When (Cairo)" }, { key: "user", label: "User" }, { key: "typed", label: "Typed user name" },
          { key: "action", label: "Action" }, { key: "code", label: "Action code" }, { key: "recordType", label: "Record type" },
          { key: "recordName", label: "Record" }, { key: "recordId", label: "Record ID" }, { key: "ip", label: "IP address" }, { key: "details", label: "Details" },
        ],
        rows: rows.map((r) => ({
          when: formatCairo(r.at), user: r.userName ?? "", typed: r.typedUsername ?? "", action: AUDIT_ACTIONS[r.action as AuditAction] ?? r.action,
          code: r.action, recordType: r.recordType ?? "", recordName: r.recordName ?? "", recordId: r.recordId ?? "", ip: r.ip ?? "", details: r.details ?? "",
        })),
      };
      const book = await buildWorkbook([sheet]);
      await recordAudit({ action: "AUDIT_LOG_EXPORTED", user: me, record: { type: "Audit log" }, details: { from: aq.from, to: aq.to, user: q.user ?? null, action: q.action ?? null, rows: rows.length } });
      return file(book, "audit-log");
    }

    case "template":
      return file(await buildWorkbook(importTemplateSheets()), "import-template");

    default:
      return NextResponse.json({ error: "Unknown export" }, { status: 404 });
  }
}
