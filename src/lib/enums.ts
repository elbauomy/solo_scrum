// Fixed sets of values stored as text columns. SQL Server has no enum type, so the allowed values live here
// and every write goes through code that only uses them.

export const WORK_ITEM_TYPES = ["EPIC", "FEATURE", "STORY", "BUG", "TASK"] as const;
export type WorkItemType = (typeof WORK_ITEM_TYPES)[number];

/** Story/Bug: NEW, APPROVED, COMMITTED, DONE. Task: NEW, IN_PROGRESS, DONE. Epics and features stay NEW. */
export const WORK_ITEM_STATUSES = ["NEW", "APPROVED", "COMMITTED", "IN_PROGRESS", "DONE"] as const;
export type WorkItemStatus = (typeof WORK_ITEM_STATUSES)[number];

export const PRIORITY_VALUES = ["HIGH", "MEDIUM", "LOW"] as const;
export type Priority = (typeof PRIORITY_VALUES)[number];

export const SPRINT_STATES = ["PLANNED", "ACTIVE", "PAUSED", "CLOSED"] as const;
export type SprintState = (typeof SPRINT_STATES)[number];
