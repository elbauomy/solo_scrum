import type { SprintState } from "@/lib/enums";
import type { Health } from "@/lib/planning";
import { cn } from "@/components/ui";

const LEVEL: Record<Health["level"], string> = {
  green: "bg-green-100 text-green-800",
  amber: "bg-amber-100 text-amber-800",
  red: "bg-red-100 text-red-700",
};
const LEVEL_DOT: Record<Health["level"], string> = { green: "bg-green-500", amber: "bg-amber-500", red: "bg-red-500" };
const LEVEL_TEXT: Record<Health["level"], string> = { green: "Healthy", amber: "Watch", red: "Needs action" };

export function HealthBadge({ health }: { health: Health }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold", LEVEL[health.level])} title={LEVEL_TEXT[health.level]}>
      <span className={cn("h-2 w-2 rounded-full", LEVEL_DOT[health.level])} />
      {health.score}
    </span>
  );
}

export function healthText(level: Health["level"]): string {
  return LEVEL_TEXT[level];
}

const STATE: Record<SprintState, string> = {
  PLANNED: "bg-slate-100 text-slate-700",
  ACTIVE: "bg-orange-100 text-orange-800",
  PAUSED: "bg-amber-100 text-amber-900",
  CLOSED: "bg-green-100 text-green-800",
};
const STATE_LABEL: Record<SprintState, string> = { PLANNED: "Planned", ACTIVE: "Active", PAUSED: "Paused", CLOSED: "Closed" };

export function SprintStateBadge({ state }: { state: SprintState }) {
  return <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", STATE[state])}>{STATE_LABEL[state]}</span>;
}
export const stateLabel = (s: SprintState) => STATE_LABEL[s];

export function HealthParts({ parts }: { parts: Health["parts"] }) {
  const rows: [string, number, string][] = [
    ["Burndown on track", parts.burndown, "30%"],
    ["Commitment reliability", parts.reliability, "25%"],
    ["Scope stability", parts.scope, "15%"],
    ["Load balance", parts.load, "15%"],
    ["Blocked / slipped", parts.blocked, "15%"],
  ];
  return (
    <ul className="space-y-1.5">
      {rows.map(([label, value, weight]) => (
        <li key={label} className="text-xs">
          <div className="flex justify-between text-slate-600">
            <span>{label} <span className="text-slate-400">({weight})</span></span>
            <span>{value}%</span>
          </div>
          <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-slate-200">
            <div className={cn("h-full rounded-full", value >= 80 ? "bg-green-500" : value >= 60 ? "bg-amber-500" : "bg-red-500")} style={{ width: `${value}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function LoadBar({ assigned, capacity }: { assigned: number; capacity: number }) {
  const pct = capacity > 0 ? Math.round((assigned / capacity) * 100) : assigned > 0 ? 999 : 0;
  const over = assigned > capacity + 0.01;
  return (
    <div className="flex items-center gap-2" title={`${assigned}h assigned of ${capacity}h capacity`}>
      <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-200">
        <div className={cn("h-full rounded-full", over ? "bg-red-500" : pct >= 70 ? "bg-green-500" : "bg-amber-400")} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <span className={cn("text-xs", over ? "font-semibold text-red-700" : "text-slate-600")}>{pct > 900 ? "no capacity" : `${pct}%`}</span>
    </div>
  );
}

export const fmtH = (h: number) => `${Number.isInteger(h) ? h : h.toFixed(1)}h`;
