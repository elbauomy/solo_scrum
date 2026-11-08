import { PrismaClient } from "@prisma/client";
import type { Priority, SprintState, WorkItemStatus, WorkItemType } from "./enums";

/**
 * SQL Server stores these fixed values as text. This extension only narrows their TypeScript types to the allowed
 * values (see enums.ts), so the rest of the code keeps its exact types; the stored values are unchanged.
 */
function createClient() {
  return new PrismaClient().$extends({
    result: {
      workItem: {
        type: { needs: { type: true }, compute: (w) => w.type as WorkItemType },
        status: { needs: { status: true }, compute: (w) => w.status as WorkItemStatus },
        priority: { needs: { priority: true }, compute: (w) => w.priority as Priority },
      },
      sprint: {
        state: { needs: { state: true }, compute: (s) => s.state as SprintState },
      },
    },
  });
}

export type Db = ReturnType<typeof createClient>;
/** The client inside db.$transaction(async (tx) => ...). */
export type Tx = Parameters<Parameters<Db["$transaction"]>[0]>[0];

// Reuse one client across hot reloads in development.
const globalForPrisma = globalThis as unknown as { prisma?: Db };

export const db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
