"use client";

import { useState, useTransition } from "react";
import type { WorkItemStatus } from "@/lib/enums";
import { setWorkItemStatus } from "@/lib/actions/work-items";
import { STATUS_LABEL } from "@/lib/work-items";
import { cn } from "@/components/ui";
import { useReadOnly } from "@/components/role-provider";

/** Status dropdown that saves as soon as it changes. */
export function StatusSelect({
  id,
  status,
  options,
  className,
}: {
  id: string;
  status: WorkItemStatus;
  options: WorkItemStatus[];
  className?: string;
}) {
  const [value, setValue] = useState(status);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const readOnly = useReadOnly();

  return (
    <span className="inline-flex items-center gap-1">
      <select
        aria-label="Status"
        value={value}
        disabled={pending || readOnly}
        onChange={(e) => {
          const next = e.target.value as WorkItemStatus;
          const previous = value;
          setValue(next);
          setError(null);
          startTransition(async () => {
            try {
              const res = await setWorkItemStatus(id, next);
              if (res.error) {
                setValue(previous);
                setError(res.error);
              }
            } catch {
              setValue(previous);
              setError("This change was not saved. You may be signed out, or this is a view-only account.");
            }
          });
        }}
        className={cn(
          "rounded-md border border-slate-300 bg-white px-1.5 py-1 text-xs focus:border-orange-500 focus:outline-none",
          value === "DONE" && "border-green-300 bg-green-50 text-green-800",
          pending && "opacity-60",
          className,
        )}
      >
        {options.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABEL[s]}
          </option>
        ))}
      </select>
      {error && (
        <span role="alert" className="text-xs text-red-600">
          {error}
        </span>
      )}
    </span>
  );
}
