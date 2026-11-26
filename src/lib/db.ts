import { PrismaClient, type Prisma } from "@prisma/client";

/** The client inside db.$transaction(async (tx) => ...). */
export type Tx = Prisma.TransactionClient;

// Reuse one client across hot reloads in development.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
