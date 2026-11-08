import type { Priority, WorkItemStatus, WorkItemType } from "@/lib/enums";
import { PRIORITY_LABEL, STATUS_LABEL, TYPE_LABEL } from "@/lib/work-items";
import { cn } from "@/components/ui";

const TYPE_STYLE: Record<WorkItemType, string> = {
  EPIC: "bg-purple-100 text-purple-800",
  FEATURE: "bg-sky-100 text-sky-800",
  STORY: "bg-emerald-100 text-emerald-800",
  BUG: "bg-red-100 text-red-700",
  TASK: "bg-slate-100 text-slate-700",
};

export function TypeBadge({ type, short }: { type: WorkItemType; short?: boolean }) {
  const label = short ? { EPIC: "Epic", FEATURE: "Feat", STORY: "Story", BUG: "Bug", TASK: "Task" }[type] : TYPE_LABEL[type];
  return <span className={cn("inline-flex shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold", TYPE_STYLE[type])}>{label}</span>;
}

const STATUS_STYLE: Record<WorkItemStatus, string> = {
  NEW: "bg-slate-100 text-slate-700",
  APPROVED: "bg-sky-100 text-sky-800",
  COMMITTED: "bg-orange-100 text-orange-800",
  IN_PROGRESS: "bg-amber-100 text-amber-800",
  DONE: "bg-green-100 text-green-800",
};

export function StatusBadge({ status }: { status: WorkItemStatus }) {
  return <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", STATUS_STYLE[status])}>{STATUS_LABEL[status]}</span>;
}

const PRIORITY_STYLE: Record<Priority, string> = {
  HIGH: "text-red-700",
  MEDIUM: "text-amber-700",
  LOW: "text-slate-500",
};

export function PriorityLabel({ priority }: { priority: Priority }) {
  return <span className={cn("text-xs font-medium", PRIORITY_STYLE[priority])}>{PRIORITY_LABEL[priority]}</span>;
}

export function ProgressBar({ value }: { value: number | null }) {
  if (value == null) return <span className="text-xs text-slate-400">—</span>;
  return (
    <div className="flex items-center gap-2" title={`${value}% done`}>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200">
        <div className="h-full rounded-full bg-orange-500" style={{ width: `${value}%` }} />
      </div>
      <span className="text-xs text-slate-600">{value}%</span>
    </div>
  );
}

export function formatHours(h: number): string {
  return `${Number.isInteger(h) ? h : h.toFixed(1)}h`;
}
