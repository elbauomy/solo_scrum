"use client";

import { useState, useTransition } from "react";
import { syncLob } from "@/lib/actions/azure";
import type { ActionState } from "@/lib/action-state";
import { useReadOnly } from "@/components/role-provider";
import { Button } from "@/components/ui";

/** "Check changes" shows what would happen; "Sync now" does it. */
export function AzureSyncButtons({ lobId, linked }: { lobId: string; linked: boolean }) {
  const readOnly = useReadOnly();
  const [includeOld, setIncludeOld] = useState(false);
  const [result, setResult] = useState<(ActionState & { mode: "check" | "sync" }) | null>(null);
  const [pending, start] = useTransition();
  if (readOnly) return null;

  function run(mode: "check" | "sync") {
    setResult(null);
    start(async () => {
      try {
        setResult({ ...(await syncLob(lobId, mode, includeOld)), mode });
      } catch {
        setResult({ mode, error: "The sync could not finish (it may have taken too long). Press Check changes to see where things stand, then try again." });
      }
    });
  }

  const sync = result?.sync;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" disabled={pending || !linked} onClick={() => run("check")}>{pending ? "Working…" : "Check changes"}</Button>
        <Button type="button" disabled={pending || !linked} onClick={() => run("sync")}>Sync now</Button>
        <label className="flex items-center gap-1.5 text-xs text-slate-600">
          <input type="checkbox" checked={includeOld} onChange={(e) => setIncludeOld(e.target.checked)} />
          Also bring in old finished items
        </label>
      </div>
      {result?.error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{result.error}</p>}
      {sync && (
        <div role="status" className={`rounded-md px-3 py-2 text-sm ${result?.mode === "sync" && sync.errors.length === 0 ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-900"}`}>
          <p className="font-medium">{result?.mode === "check" ? "Nothing was changed. This is what Sync now would do:" : "Sync finished."}</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
            {sync.lines.map((l, i) => <li key={i}>{l}</li>)}
          </ul>
          {sync.errors.length > 0 && (
            <>
              <p className="mt-2 text-xs font-medium">Needs attention:</p>
              <ul className="list-disc space-y-0.5 pl-5 text-xs">
                {sync.errors.slice(0, 10).map((l, i) => <li key={i}>{l}</li>)}
                {sync.errors.length > 10 && <li>…and {sync.errors.length - 10} more.</li>}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
