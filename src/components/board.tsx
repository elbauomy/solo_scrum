"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { Priority, WorkItemStatus, WorkItemType } from "@/lib/enums";
import { setWorkItemStatus } from "@/lib/actions/work-items";
import { quickAssign } from "@/lib/actions/sprints";
import { PRIORITY_LABEL, STATUS_LABEL, statusesFor } from "@/lib/work-items";
import { cn } from "@/components/ui";
import { useReadOnly } from "@/components/role-provider";
import { TypeBadge } from "@/components/work-items/badges";
import { StatusSelect } from "@/components/work-items/status-select";

export type BoardCard = {
  id: string;
  key: string;
  title: string;
  type: WorkItemType;
  status: WorkItemStatus;
  priority: Priority;
  assigneeId: string | null;
  assigneeName: string | null;
  hours: number | null;
  blocked: boolean;
  parentLabel: string;
};
export type BoardColumn = { id: string; title: string; sub?: string };

const PRIORITY_DOT: Record<Priority, string> = { HIGH: "bg-red-500", MEDIUM: "bg-amber-400", LOW: "bg-slate-300" };

export function Board({ cards: initial, columns, group }: { cards: BoardCard[]; columns: BoardColumn[]; group: "status" | "member" }) {
  const [cards, setCards] = useState(initial);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const readOnly = useReadOnly();

  const columnOf = (c: BoardCard) => (group === "status" ? c.status : c.assigneeId ?? "none");

  function canDrop(card: BoardCard, col: string): boolean {
    if (group === "status") return statusesFor(card.type).includes(col as WorkItemStatus);
    return card.type === "TASK";
  }

  function drop(col: string) {
    const card = cards.find((c) => c.id === dragId);
    setDragId(null);
    setOverCol(null);
    if (!card || columnOf(card) === col) return;
    if (!canDrop(card, col)) {
      setError(group === "status" ? `${card.key} cannot be moved to ${STATUS_LABEL[col as WorkItemStatus]}.` : "Only tasks can be assigned.");
      return;
    }
    setError(null);
    const before = cards;
    const names = new Map(columns.map((c) => [c.id, c.title]));
    setCards(
      cards.map((c) =>
        c.id !== card.id
          ? c
          : group === "status"
            ? { ...c, status: col as WorkItemStatus }
            : { ...c, assigneeId: col === "none" ? null : col, assigneeName: col === "none" ? null : names.get(col) ?? null },
      ),
    );
    startTransition(async () => {
      try {
        const res = group === "status" ? await setWorkItemStatus(card.id, col as WorkItemStatus) : await quickAssign(card.id, col === "none" ? null : col);
        if (res.error) {
          setCards(before);
          setError(res.error);
        }
      } catch {
        setCards(before);
        setError("This change was not saved. You may be signed out, or this is a view-only account.");
      }
    });
  }

  return (
    <div>
      {error && <p role="alert" className="mb-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {columns.map((col) => {
          const list = cards.filter((c) => columnOf(c) === col.id);
          const hours = list.reduce((s, c) => s + (c.hours ?? 0), 0);
          const dragging = cards.find((c) => c.id === dragId);
          const allowed = dragging ? canDrop(dragging, col.id) : true;
          return (
            <section
              key={col.id}
              aria-label={col.title}
              onDragOver={(e) => {
                if (dragging && allowed) {
                  e.preventDefault();
                  setOverCol(col.id);
                }
              }}
              onDragLeave={() => setOverCol((o) => (o === col.id ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                drop(col.id);
              }}
              className={cn(
                "flex w-72 shrink-0 flex-col rounded-lg border bg-slate-50",
                overCol === col.id ? "border-orange-400 bg-orange-50" : "border-slate-200",
                dragging && !allowed && "opacity-50",
              )}
            >
              <header className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
                <div>
                  <h3 className="text-sm font-semibold text-slate-800">{col.title}</h3>
                  {col.sub && <div className="text-[11px] text-slate-500">{col.sub}</div>}
                </div>
                <div className="text-right text-xs text-slate-500">
                  <div>{list.length} item(s)</div>
                  {hours > 0 && <div>{hours}h</div>}
                </div>
              </header>
              <div className="min-h-24 flex-1 space-y-2 p-2">
                {list.map((c) => (
                  <article
                    key={c.id}
                    draggable={!readOnly}
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", c.id);
                      setDragId(c.id);
                    }}
                    onDragEnd={() => {
                      setDragId(null);
                      setOverCol(null);
                    }}
                    className={cn(!readOnly && "cursor-grab", "rounded-md border bg-white p-2 shadow-sm", c.blocked ? "border-red-300" : "border-slate-200", dragId === c.id && "opacity-40")}
                  >
                    <div className="mb-1 flex items-center gap-1.5 text-xs">
                      <TypeBadge type={c.type} short />
                      <Link href={`/items/${c.id}`} className="font-mono text-slate-500 hover:underline">{c.key}</Link>
                      <span className={cn("ml-auto h-2 w-2 rounded-full", PRIORITY_DOT[c.priority])} title={`${PRIORITY_LABEL[c.priority]} priority`} />
                      {c.blocked && <span className="rounded bg-red-100 px-1 text-[10px] font-semibold text-red-700">Blocked</span>}
                    </div>
                    <Link href={`/items/${c.id}`} className="block text-sm text-slate-900 hover:underline">{c.title}</Link>
                    {c.parentLabel && <div className="mt-0.5 truncate text-[11px] text-slate-400" title={c.parentLabel}>{c.parentLabel}</div>}
                    <div className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-600">
                      <span>{c.type === "TASK" ? c.assigneeName ?? <span className="text-amber-700">Unassigned</span> : ""}</span>
                      <span>{c.hours != null ? `${c.hours}h` : c.type === "TASK" ? <span className="text-amber-700">No estimate</span> : ""}</span>
                    </div>
                    {group === "member" && statusesFor(c.type).length > 0 && (
                      <div className="mt-2"><StatusSelect key={`${c.id}-${c.status}`} id={c.id} status={c.status} options={statusesFor(c.type)} /></div>
                    )}
                  </article>
                ))}
                {list.length === 0 && <p className="py-4 text-center text-xs text-slate-400">Nothing here</p>}
              </div>
            </section>
          );
        })}
      </div>
      {!readOnly && <p className="mt-2 text-xs text-slate-500">Drag a card to {group === "status" ? "change its status" : "assign a task to a member"}.</p>}
    </div>
  );
}
