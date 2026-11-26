import "server-only";
import { db } from "./db";
import type { WorkCalendar } from "./capacity";
import { toISODate } from "./dates";
import type { SecuritySettings } from "./sign-in-security";

/**
 * The single settings row, created with defaults on first use.
 * Several parts of a page can ask for it at the same moment on a brand-new database, so creating it must not fail
 * when another request got there first.
 */
export async function getSettings() {
  const existing = await db.setting.findUnique({ where: { id: 1 } });
  if (existing) return existing;
  await db.setting.createMany({ data: { id: 1 }, skipDuplicates: true });
  return db.setting.findUniqueOrThrow({ where: { id: 1 } });
}

export async function getWorkCalendar(): Promise<WorkCalendar> {
  const [settings, holidays] = await Promise.all([getSettings(), db.holiday.findMany()]);
  return {
    workingDays: settings.workingDays,
    holidays: new Set(holidays.map((h) => toISODate(h.date))),
  };
}

/** The sign-in security values (BR-58). */
export async function getSecuritySettings(): Promise<SecuritySettings> {
  const s = await getSettings();
  return { minPasswordLength: s.minPasswordLength, maxFailedSignIns: s.maxFailedSignIns, lockMinutes: s.lockMinutes, idleMinutes: s.idleMinutes };
}
