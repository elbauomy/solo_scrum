import { Prisma } from "@prisma/client";
import { ForbiddenError } from "./forbidden";
import { z } from "zod";

/** What every form action returns. */
import type { SprintImportPreview } from "./sprint-sheet";
import type { SyncSummary } from "./ado-sync";

export type ActionState = {
  error?: string;
  ok?: boolean;
  message?: string;
  details?: string[];
  /** Sprint planning import: what was read from the sheet and what will happen */
  preview?: SprintImportPreview;
  link?: { href: string; label: string };
  /** Azure DevOps sync: what was (or would be) done */
  sync?: SyncSummary;
};

export const initialState: ActionState = {};

/** Turn known errors into a friendly message for the form. */
export function toActionError(err: unknown): ActionState {
  if (err instanceof ForbiddenError) return { error: err.message };
  if (err instanceof z.ZodError) {
    return { error: err.issues.map((i) => i.message).join(". ") };
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") return { error: "That name is already used. Please choose another." };
    if (err.code === "P2003") return { error: "This record is still in use and cannot be deleted." };
    if (err.code === "P2025") return { error: "This record no longer exists." };
  }
  // Let Next.js redirects (e.g. to /login) pass through.
  if (err && typeof err === "object" && "digest" in err) throw err;
  console.error(err);
  return { error: "Something went wrong. Please try again." };
}

/** Read FormData into a plain object for Zod. */
export function formObject(formData: FormData): Record<string, FormDataEntryValue> {
  return Object.fromEntries(formData.entries());
}

/** Optional positive integer from a text input ("" -> null). */
export const optionalInt = z.preprocess(
  (v) => (v === "" || v === undefined || v === null ? null : Number(v)),
  z.number().int("Must be a whole number").min(1, "Must be at least 1").max(365, "Must be 365 or less").nullable(),
);

export const requiredName = z.string().trim().min(1, "Name is required").max(100, "Name is too long");
export const optionalText = z.string().trim().max(1000, "Text is too long").default("");
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Please pick a valid date");
