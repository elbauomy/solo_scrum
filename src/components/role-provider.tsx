"use client";

import { createContext, useContext, type ReactNode } from "react";

const ReadOnlyContext = createContext(false);
const PermissionContext = createContext<ReadonlySet<string>>(new Set());

/** When `readOnly` is true every editing control below it (forms, buttons, drag and drop) switches itself off. */
export function RoleProvider({ readOnly, children }: { readOnly: boolean; children: ReactNode }) {
  return <ReadOnlyContext.Provider value={readOnly}>{children}</ReadOnlyContext.Provider>;
}

/** Makes the signed-in user's permissions available to client components (for showing or hiding controls only). */
export function PermissionProvider({ permissions, children }: { permissions: string[]; children: ReactNode }) {
  return <PermissionContext.Provider value={new Set(permissions)}>{children}</PermissionContext.Provider>;
}

/** True when the nearest page section is read-only for this user. */
export const useReadOnly = () => useContext(ReadOnlyContext);

/** True when the signed-in user has the permission. The server checks again; this only hides controls. */
export const useCan = (permission: string) => useContext(PermissionContext).has(permission);
