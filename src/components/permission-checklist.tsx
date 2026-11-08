"use client";

import { useState } from "react";
import type { PermissionGroup } from "@/lib/permissions";
import { useReadOnly } from "@/components/role-provider";

/**
 * One block per page or feature. Ticking any permission also ticks that group's "View"
 * (you cannot change what you cannot see); unticking "View" clears the group.
 */
export function PermissionChecklist({ groups, initial, locked = false }: { groups: PermissionGroup[]; initial: string[]; locked?: boolean }) {
  const readOnly = useReadOnly() || locked;
  const [on, setOn] = useState(() => new Set(initial));

  function toggle(group: PermissionGroup, key: string, checked: boolean) {
    const next = new Set(on);
    const view = `${group.key}.view`;
    const hasView = group.permissions.some((p) => p.key === view);
    if (checked) {
      next.add(key);
      if (hasView) next.add(view);
    } else if (key === view) {
      for (const p of group.permissions) next.delete(p.key);
    } else {
      next.delete(key);
    }
    setOn(next);
  }

  function setGroup(group: PermissionGroup, checked: boolean) {
    const next = new Set(on);
    for (const p of group.permissions) {
      if (checked) next.add(p.key);
      else next.delete(p.key);
    }
    setOn(next);
  }

  const total = groups.reduce((n, g) => n + g.permissions.length, 0);
  return (
    <div className="space-y-3">
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
          <span>{on.size} of {total} permissions</span>
          <button type="button" className="font-medium text-orange-700 hover:underline" onClick={() => setOn(new Set(groups.flatMap((g) => g.permissions.map((p) => p.key))))}>Tick all</button>
          <button type="button" className="font-medium text-orange-700 hover:underline" onClick={() => setOn(new Set(groups.flatMap((g) => g.permissions.filter((p) => p.key.endsWith(".view")).map((p) => p.key))))}>View only</button>
          <button type="button" className="font-medium text-orange-700 hover:underline" onClick={() => setOn(new Set())}>Clear</button>
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {groups.map((g) => {
          const all = g.permissions.every((p) => on.has(p.key));
          return (
            <fieldset key={g.key} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5" disabled={readOnly}>
              <legend className="sr-only">{g.label}</legend>
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-slate-900">{g.label}</span>
                {!readOnly && g.permissions.length > 1 && (
                  <button type="button" className="text-xs font-medium text-orange-700 hover:underline" onClick={() => setGroup(g, !all)}>
                    {all ? "None" : "All"}
                  </button>
                )}
              </div>
              <ul className="space-y-1.5">
                {g.permissions.map((p) => (
                  <li key={p.key}>
                    <label className="flex items-start gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        name="permission"
                        value={p.key}
                        checked={on.has(p.key)}
                        onChange={(e) => toggle(g, p.key, e.target.checked)}
                        className="mt-1"
                      />
                      <span>
                        {p.label}
                        {p.hint && <span className="block text-xs text-slate-500">{p.hint}</span>}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          );
        })}
      </div>
    </div>
  );
}
