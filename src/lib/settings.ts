import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "./db";
import type { WorkCalendar } from "./capacity";
import { toISODate } from "./dates";

/**
 * The single settings row, created with defaults on first use.
 * Several parts of a page can ask for it at the same moment on a brand-new database, so creating it must not fail
 * when another request got there first.
 */
export async function getSettings() {
  const existing = await db.setting.findUnique({ where: { id: 1 } });
  if (existing) return withDays(existing);
  try {
    await db.setting.create({ data: { id: 1 } });
  } catch (err) {
    // Another request created the row first: that is fine.
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
  }
  return withDays(await db.setting.findUniqueOrThrow({ where: { id: 1 } }));
}

/** Working days are stored as text ("1,2,3,4,5") because SQL Server has no list columns. */
export function parseWorkingDays(value: string): number[] {
  const days = value.split(",").map((d) => Number(d.trim())).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  return [...new Set(days)].sort((a, b) => a - b);
}

export function formatWorkingDays(days: number[]): string {
  return [...new Set(days)].sort((a, b) => a - b).join(",");
}

function withDays<T extends { workingDays: string }>(row: T): Omit<T, "workingDays"> & { workingDays: number[] } {
  return { ...row, workingDays: parseWorkingDays(row.workingDays) };
}

export async function getWorkCalendar(): Promise<WorkCalendar> {
  const [settings, holidays] = await Promise.all([getSettings(), db.holiday.findMany()]);
  return {
    workingDays: settings.workingDays,
    holidays: new Set(holidays.map((h) => toISODate(h.date))),
  };
}
