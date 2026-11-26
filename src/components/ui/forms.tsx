"use client";

import { Fragment, createContext, useActionState, useContext, useEffect, useRef, useTransition, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button, cn } from "./index";
import type { ActionState } from "@/lib/action-state";
import { useReadOnly } from "@/components/role-provider";

type Action = (state: ActionState, formData: FormData) => Promise<ActionState>;

/** Whether the ActionForm around a button is sending. */
const PendingContext = createContext<boolean | null>(null);

/** A form that runs a Server Action and shows its error or success message. */
export function ActionForm({
  action,
  children,
  className,
  successMessage,
  resetOnSuccess = true,
  onSuccess,
  version,
}: {
  action: Action;
  children: ReactNode;
  className?: string;
  successMessage?: string;
  resetOnSuccess?: boolean;
  /** Runs after a successful submit (after the form is cleared when resetOnSuccess). */
  onSuccess?: () => void;
  /**
   * For edit forms: a value that changes when the saved record changes (for example its updatedAt).
   * The fields are rebuilt from the new saved values, so a second save never sends stale defaults,
   * while the form keeps its "Saved." message.
   */
  version?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [, startTransition] = useTransition();
  const readOnly = useReadOnly();
  const ref = useRef<HTMLFormElement>(null);
  const onSuccessRef = useRef(onSuccess);
  useEffect(() => {
    onSuccessRef.current = onSuccess;
  });

  useEffect(() => {
    if (!state.ok) return;
    if (resetOnSuccess) ref.current?.reset();
    onSuccessRef.current?.();
  }, [state, resetOnSuccess]);

  // The view-only account sees the values but cannot type in them or send them.
  if (readOnly) {
    return (
      <form className={className} onSubmit={(e) => e.preventDefault()}>
        <fieldset disabled className="contents"><Fragment key={version}>{children}</Fragment></fieldset>
      </form>
    );
  }
  return (
    // Sent by hand instead of <form action>: React resets a form after every action call, which would wipe what the
    // user typed when the server answers with an error. Here the form is only cleared after a success (resetOnSuccess).
    <form
      ref={ref}
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
        startTransition(() => formAction(data));
      }}
    >
      <PendingContext.Provider value={pending}>
        <Fragment key={version}>{children}</Fragment>
      </PendingContext.Provider>
      {state.error && (
        <p role="alert" className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}
      {state.ok && (state.message || successMessage) && (
        <p role="status" className="mt-2 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">
          {state.message || successMessage}
        </p>
      )}
    </form>
  );
}

export function SubmitButton({ children, variant, className, disabled }: { children: ReactNode; variant?: "primary" | "secondary" | "danger"; className?: string; disabled?: boolean }) {
  const status = useFormStatus();
  const inActionForm = useContext(PendingContext);
  const pending = inActionForm ?? status.pending;
  const readOnly = useReadOnly();
  if (readOnly) return null;
  return (
    <Button type="submit" variant={variant} disabled={pending || disabled} className={className}>
      {pending ? "Saving…" : children}
    </Button>
  );
}

/** Small inline form with one button that asks for confirmation first. */
export function DeleteButton({
  action,
  id,
  label = "Delete",
  confirmText = "Are you sure you want to delete this?",
  className,
}: {
  action: Action;
  id: string;
  label?: string;
  confirmText?: string;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const readOnly = useReadOnly();
  if (readOnly) return null;
  return (
    <form
      action={formAction}
      className={cn("inline", className)}
      onSubmit={(e) => {
        if (!confirm(confirmText)) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <Button type="submit" variant="danger" disabled={pending} className="px-2 py-1 text-xs">
        {pending ? "…" : label}
      </Button>
      {state.error && (
        <span role="alert" className="ml-2 text-xs text-red-600">
          {state.error}
        </span>
      )}
    </form>
  );
}
