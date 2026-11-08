"use client";

import { useMemo, useState } from "react";
import type { WorkItemType } from "@/lib/enums";
import { createWorkItem } from "@/lib/actions/work-items";
import { childTypesOf, PARENT_REQUIRED, PARENT_TYPES, PRIORITIES, PRIORITY_LABEL, TYPES, TYPE_LABEL } from "@/lib/work-items";
import { ActionForm, SubmitButton } from "@/components/ui/forms";
import { Field, Input, Select } from "@/components/ui";

export type LobOption = { id: string; name: string; key: string; squadId: string };
export type ParentOption = { id: string; key: string; title: string; type: WorkItemType; lobId: string };
export type MemberOption = { id: string; name: string };

export function NewItemForm({
  lobs,
  parents,
  membersBySquad,
  fixedParent,
  defaultLobId,
}: {
  lobs: LobOption[];
  parents: ParentOption[];
  membersBySquad: Record<string, MemberOption[]>;
  /** When adding a child from an item page */
  fixedParent?: ParentOption;
  defaultLobId?: string;
}) {
  const allowedTypes = fixedParent ? childTypesOf(fixedParent.type) : TYPES;
  const [type, setType] = useState<WorkItemType>(allowedTypes[0]);
  const [lobId, setLobId] = useState(fixedParent?.lobId ?? defaultLobId ?? (lobs.length === 1 ? lobs[0].id : ""));
  const [parentId, setParentId] = useState(fixedParent?.id ?? "");
  // React resets the form after a successful submit; re-mounting the dropdowns
  // puts back the chosen type, line of business and parent so similar items are quick to add.
  const [resetCount, setResetCount] = useState(0);

  const parentChoices = useMemo(
    () => parents.filter((p) => PARENT_TYPES[type].includes(p.type) && (!lobId || p.lobId === lobId)),
    [parents, type, lobId],
  );
  const parent = fixedParent ?? parents.find((p) => p.id === parentId);
  const effectiveLobId = parent?.lobId ?? lobId;
  const squadId = lobs.find((l) => l.id === effectiveLobId)?.squadId;
  const members = squadId ? membersBySquad[squadId] ?? [] : [];
  const needsParent = PARENT_TYPES[type].length > 0;

  return (
    <ActionForm action={createWorkItem} className="grid gap-3 md:grid-cols-6 md:items-end" successMessage="Item added." resetOnSuccess={false} onSuccess={() => setResetCount((n) => n + 1)}>
      <Field label="Type" className="md:col-span-1">
        <Select
          key={`type-${resetCount}`}
          name="type"
          value={type}
          onChange={(e) => {
            const t = e.target.value as WorkItemType;
            setType(t);
            if (!fixedParent) setParentId("");
          }}
        >
          {allowedTypes.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </Select>
      </Field>

      {fixedParent ? (
        <input type="hidden" name="parentId" value={fixedParent.id} />
      ) : (
        <>
          <Field label="Line of Business" className="md:col-span-1">
            <Select
              key={`lob-${resetCount}`}
              name="lobId"
              value={lobId}
              onChange={(e) => {
                setLobId(e.target.value);
                setParentId("");
              }}
              required={!parent}
            >
              <option value="">Choose…</option>
              {lobs.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.key} · {l.name}
                </option>
              ))}
            </Select>
          </Field>
          {needsParent && (
            <Field label={PARENT_REQUIRED[type] ? "Parent" : "Parent (optional)"} className="md:col-span-2">
              <Select key={`parent-${resetCount}`} name="parentId" value={parentId} onChange={(e) => setParentId(e.target.value)} required={PARENT_REQUIRED[type]}>
                <option value="">{PARENT_REQUIRED[type] ? "Choose…" : "No parent"}</option>
                {parentChoices.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.key} · {TYPE_LABEL[p.type]}: {p.title}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </>
      )}

      <Field label="Title" className={fixedParent || !needsParent ? "md:col-span-3" : "md:col-span-2"}>
        <Input name="title" required maxLength={200} placeholder={`New ${TYPE_LABEL[type].toLowerCase()} title`} />
      </Field>

      <Field label="Priority" className="md:col-span-1">
        <Select name="priority" defaultValue="MEDIUM">
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABEL[p]}
            </option>
          ))}
        </Select>
      </Field>

      {type === "TASK" && (
        <>
          <Field label="Assignee" className="md:col-span-2">
            <Select name="assigneeId" defaultValue="">
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Estimate (hours)" className="md:col-span-1">
            <Input type="number" name="estimateHours" min="0" max="1000" step="0.25" placeholder="e.g. 6" />
          </Field>
        </>
      )}

      <div className="md:col-span-1">
        <SubmitButton className="w-full">Add {TYPE_LABEL[type]}</SubmitButton>
      </div>
      {needsParent && !fixedParent && parentChoices.length === 0 && PARENT_REQUIRED[type] && (
        <p className="text-xs text-amber-700 md:col-span-6">
          There is no {PARENT_TYPES[type].map((t) => TYPE_LABEL[t]).join(" or ")} {lobId ? "in this line of business" : ""} yet. Create one first.
        </p>
      )}
    </ActionForm>
  );
}
