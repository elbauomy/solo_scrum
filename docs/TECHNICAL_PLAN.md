# Solo Scrum — Technical Plan

This is the technical reference for the whole project. The agreed product scope is in
[PRODUCT_PLAN.md](./PRODUCT_PLAN.md). Each phase updates this file when a design decision changes.

## 1. Guiding principles

- **Simple over clever.** One app, one database, one host. No microservices, no queues, no extra paid services.
- **One user (v1).** The Scrum Master is the only login. Squad members are records, not accounts.
- **Free hosting.** Vercel (Hobby) + Neon PostgreSQL (free plan) + GitHub. `netlify.toml` is kept as an alternative.
- **History instead of background jobs.** Every change that affects a report (status, estimate,
  sprint membership, release date) is written to a history table. Reports are calculated from this
  history when you open them, so no daily scheduled job is needed.

## 2. Stack

| Concern | Choice | Notes |
|---|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript | Server Components for pages, Server Actions for every create/update/delete |
| Styling | Tailwind CSS 4 | Small set of in-house UI components in `src/components/ui` |
| Database | PostgreSQL 16 (Neon in production) | |
| ORM / migrations | Prisma 6 | `prisma/schema.prisma`; migrations in `prisma/migrations` |
| Validation | Zod 4 | Every Server Action validates its input |
| Auth | Single password + signed session cookie (`jose`, HS256) | No user table |
| Charts | Recharts 3 | Burndown, velocity, load, quality charts |
| Excel | ExcelJS | Report/list exports, full backup, import template and import (read + write .xlsx) |
| PDF export | Print-optimised report pages (browser "Save as PDF") | No server-side PDF engine; menu and filters are hidden when printing |
| Tests | Vitest | For the scheduling and metrics logic |

**Next.js configuration choices**

- `cacheComponents` is **off**. Everything is read live from the database on each request
  (`export const dynamic = "force-dynamic"` in the root layout). For one user this is fast enough, and it avoids stale data.
- Route protection runs in `src/proxy.ts` (Next 16's name for middleware). Every Server Action also
  checks the session, because actions can be called directly over HTTP.

## 3. Folder structure

```
prisma/
  schema.prisma          database tables
  migrations/            versioned schema changes
  seed.ts                default settings row
src/
  proxy.ts               redirects to /login when not signed in
  app/
    login/               login page
    (app)/               all signed-in pages, sharing the sidebar layout
      page.tsx           home dashboard
      settings/          working days, hours, holidays, sprint-length defaults
      squads/            squads list + [id] edit page
      lobs/              lines of business
      members/           members, squad hours, leave
      backlog/, items/   backlog tree, item page (phase 2)
      sprints/, board/   sprint planning, start/close, sprint board (phase 3)
      releases/          releases, forecast, date-change log (phase 3)
      timeline/          scheduled hours per member, slips, baselines (phase 4)
      standup/           daily standup + history (phase 5)
      reports/           8 reports with filters, charts, export (phase 6)
      data/              backup download + Excel import (phase 6/7)
      sprints/import/    import of the sprint planning sheet
    api/export/[name]/   Excel downloads: report, backlog, timeline, standup, backup, template
  components/ui/         buttons, inputs, tables, cards, form helpers
  lib/
    db.ts                Prisma client singleton
    auth.ts              session sign/verify, requireAuth()
    dates.ts             date-only helpers (UTC, "YYYY-MM-DD")
    capacity.ts          working-day + capacity calculations (pure, unit-tested)
    work-items.ts        hierarchy, statuses, roll-ups (pure, unit-tested)
    planning.ts          shared sprint capacity, scheduler, sprint metrics, health, forecast (pure, unit-tested)
    analytics.ts         loads everything once and builds sprint summaries, schedule and release forecasts
    reports.ts           the 8 reports as tables (used by the page, the charts and the Excel export)
    import.ts            generic work-item import: template + row validation (pure, unit-tested)
    sprint-sheet.ts      sprint planning sheet: reads the grid, plans the import (pure, unit-tested)
    excel.ts, backup.ts  .xlsx writer/reader, full backup
    actions/             Server Actions grouped by area
```

## 4. Data model

Dates without a time (sprint dates, holidays, leave) are stored as PostgreSQL `date` and handled
in code as UTC midnight, so time zones never shift a day.

### Phase 1 (built)

| Table | Key fields | Rules |
|---|---|---|
| `Setting` (one row) | `workingDays` (0=Sun … 6=Sat), `defaultDailyHours`, `defaultSprintLengthDays` | Created by the seed or on first visit |
| `Holiday` | `date` (unique), `name` | Non-working day for everyone |
| `Squad` | `name` (unique), `description`, `sprintLengthDays?` | Delete blocked while it has LOBs or members |
| `LineOfBusiness` | `name` (unique), `description`, `squadId`, `sprintLengthDays?` | Owned by exactly one squad. Sprints and releases belong to it. Delete blocked while it has work (from phase 2). |
| `Member` | `name`, `role`, `active` | Name only, no login |
| `SquadMembership` | `memberId`, `squadId`, `weeklyHours` | A member can be in several squads, with hours per week in each |
| `Leave` | `memberId`, `startDate`, `endDate`, `note` | Full days off, inclusive |

**Effective sprint length** = LOB value → squad value → system default (first one set wins).

### Phase 2 — work items (built)

| Table | Key fields |
|---|---|
| `WorkItem` | `type` (EPIC, FEATURE, STORY, BUG, TASK), `title`, `description`, `lobId`, `parentId`, `status`, `priority` (HIGH/MEDIUM/LOW), `rank` (manual order), `assigneeId?` (tasks), `estimateHours?` (tasks), `blocked`, `blockedReason`, timestamps |
| `WorkItemHistory` | `workItemId`, `field` (status, estimate, sprint, assignee, blocked), `oldValue`, `newValue`, `changedAt` |

Hierarchy rules (`src/lib/work-items.ts`): Epic (top level) → Feature (parent Epic, required) →
Story/Bug (parent Feature, optional) → Task (parent Story or Bug, required). Every item belongs to one
LOB. Children take their LOB from the parent, and an item can only move to a parent in the same LOB.

IDs: each LOB has a short `key` (2–6 letters/digits, e.g. `RB`) and a `nextItemNumber` counter, so
items are numbered `RB-1`, `RB-2`, … for each LOB. Existing LOBs got a key generated from their name
by the phase 2 migration, and it can be edited.

Fields: title, description, acceptance criteria (stories/bugs), priority, rank, status, assignee and
estimate (tasks only), blocked flag + reason, `doneAt` (set on entering DONE). Bugs have no hours of
their own; like stories, their hours come from tasks.

Assignees must be members of the squad that owns the LOB. Deleting a member unassigns their tasks.
Deleting an item is blocked while it has children. Deleting a LOB is blocked while it has items,
and its squad cannot change once it has items.

History rows are written for: created, title, status, priority, assignee, estimate, blocked, parent.
Statuses: Story/Bug = NEW → APPROVED → COMMITTED → DONE; Task = NEW → IN_PROGRESS → DONE.
Story/bug hours = sum of their tasks. Epic/feature progress is calculated from their children.

### Phase 3–5 — sprints, releases, timeline, standup (built)

| Table | Key fields |
|---|---|
| `Sprint` | `lobId`, `name`, `goal`, `startDate`, `endDate`, `state` (PLANNED, ACTIVE, CLOSED), `releaseId?`, `startedAt`, `closedAt`, `result` (JSON summary saved at close) |
| `WorkItem.sprintId` | Stories/bugs are planned into a sprint; their open tasks follow them. Done tasks stay in the sprint where they were finished. |
| `SprintMemberShare` | Optional override: percent of a member's hours this sprint gets while sprints overlap |
| `SprintCommitment` | Snapshot at sprint start: one row per task (its hours) and per story/bug (0 h, used for carry-over). `carriedOver` is set at close. |
| `Release` | `lobId`, `name`, `version`, `notes`, `targetDate`, `deployedDate?` |
| `ReleaseDateChange` | `releaseId`, `oldDate`, `newDate`, `reason`, `changedAt` |
| `TaskBaseline` | Dates the Scrum Master accepted for a task; later slips are measured against them |
| `StandupEntry` | `date`, `squadId`, `memberId`, `yesterday`, `today`, `blockers` (unique per date + squad + member) |

**Sprint lifecycle.** PLANNED (plan items, edit, delete) → ACTIVE (*Start* writes the commitment snapshot) →
CLOSED (*Close* saves the final numbers into `Sprint.result`, marks unfinished committed stories/bugs as
carried over, and moves them and their open tasks to the chosen sprint or back to the backlog). Closed
sprints are read-only and are reported from the saved result, so later changes never rewrite history.

**Members shared across squads and lines of business.** A member can belong to several squads, with hours per
week in each (`SquadMembership.weeklyHours`). Inside one squad the hours can optionally be reserved per line of
business (`MemberLobAllocation`, total never above the squad hours). Hours that are not reserved stay in a
shared pool for all of the squad's lines. Capacity of a sprint = the member's reserved hours for its line
(shared only with that line's overlapping sprints) + its share of the shared pool (shared with all of the
squad's overlapping sprints). The timeline schedules a task from its line's reserved hours first, then the
shared pool. With no reservations everything behaves as before. Assignees must still belong to the squad
that owns the line of business.

**Shared capacity.** A member's unreserved hours in a squad are split between all of that squad's sprints that cover
a day. Default is an even split; an override (percent) on a sprint takes its share first and the rest is
divided among the other sprints. Overrides adding up to more than 100% on a day raise a warning.
Sprints of any LOB in the same squad compete for the same hours.

**Releases.** One LOB, many of that LOB's sprints. Changing the target date writes a `ReleaseDateChange`
row (old, new, reason). Forecast = today + remaining hours of the release's open sprints ÷ (hours done per
day over the LOB's last 3 closed sprints).

**Standup.** Suggestions: tasks the member finished since the previous working day (yesterday), tasks In
Progress (today) and blocked tasks (blockers). Saved notes are kept per day.

### Pausing a sprint and the daily plan

**Pause / resume.** `SprintState` has a `PAUSED` state between ACTIVE and CLOSED, and `SprintPause` keeps the history
(`startDate`, `resumedOn`, `reason`, `extendedByDays`). A sprint is paused *from* a date (today or earlier, not before the
sprint start) and works again *on* `resumedOn`; the paused days are `startDate` up to the day before `resumedOn`.
While paused: its tasks are not scheduled (the timeline shows "Sprint paused"), it takes no share of members' hours on paused days
(`daySharesFor` skips a sprint on its paused days, so overlapping sprints get those hours), and paused days are not counted as working days
in its burndown ideal line and "time elapsed". On resume, "move the end date out" adds the paused *working* days to the end date (skipping weekends and
holidays, `addWorkingDays`) so the team keeps its full time; capacity taken from the planning sheet is not changed. A paused sprint can still be
edited, have items moved, or be closed (closing ends the pause). A closed sprint can have its name, goal and release corrected but keeps its dates.

**Daily plan** (`/timeline/daily`, `daily-plan.ts`). For each member and day it lists the user stories and, under each, the tasks planned that day with that
day's hours (from `TaskPlan.byDay`, in schedule order), plus the tasks finished that day and the member's weekend, holiday or leave. Filters: squad, line of business,
member, sprint, release, start date, number of days (1–28), members with no work, weekends and holidays. Excel export at `/api/export/daily-plan`.

### Deleting

`deleteMember` / `deleteMembers` (members cascade to squad hours, leave, sprint plans and standup notes; their tasks are unassigned),
`deleteSprints` (planned sprints only; items return to the backlog through `moveItemToSprint`; others are reported and kept) and
`deleteWorkItems` (an item is deleted only if all of its children are deleted in the same request; children go first, one level at a time).
Tables use `BulkDeleteBar` (checkboxes tied to one form with `form="bulk-..." name="id"`, so the tables stay server components); the backlog tree keeps its own selection
and selects an item's whole subtree when it is ticked.

### Sprint planning import

The team plans each sprint in a spreadsheet (see the Sonata sheet "Sonata - Release 6 - Sprint 62"). Uploading it
(`/sprints/import`, `.xlsx` or `.csv`) fills the system; daily follow-up then happens in the app.

| Table | Key fields |
|---|---|
| `SprintMemberPlan` | per sprint and member: `availabilityPct`, `initialHours`, `meetingsHours`, `vacationHours`, `excuseHours`, `otherHours`, `capacityHours` (the sheet's *Final Buffer*) |

**What is read** (`sprint-sheet.ts`, layout-driven, not fixed cells):
- Title row: `Line of business - Release - Sprint`, the *From* / *To* dates (month-first like `11/1/2026`, day-first when the first number is above 12, ISO and real Excel dates) and `N Days`.
- The row with *Team Member* gives the columns. A header cell `Dev (1)⏎Anna` is role `Dev (1)` and name `Anna`; a cell with only a name has no role. Columns to the right of the members (for example *Branch*) become lines in the description of a new story.
- Capacity rows between the header and the first story: availability %, *Initial buffer hours*, every `(-)` meeting row, vacations (days, converted to hours with the sheet's hours per day), excuses (hours) and the done-definition / special-task rows. Capacity = initial − meetings − vacation − excuses − other; if the sheet's own *Final Buffer* holds a number it is used, and a difference is reported.
- Stories: a row whose first column is a whole number; the title is in the next column. The following rows are task types (UI Task, Back End Task, Test Execution, Code review…). A number in a member's column is one task for that member with those hours. Stories without hours are left out.
- In a workbook the tab that contains the *Team Member* table is used, so Settings / Timeline tabs are ignored.

**What is done:** the line of business is detected from the title (or chosen in the form); the release is matched by name (a warning if missing); the sprint is created, or the existing one of the same name is updated (a closed sprint is refused). Missing members are created with their role and added to the squad with weekly hours = initial hours ÷ sheet days × working days per week; existing members not in the squad are added. Stories and tasks are matched by title (task: story + task type + member), so uploading again updates hours and creates only what is new; nothing is deleted and Done work is left alone. Existing backlog stories are moved into the sprint with their open tasks. Everything is written with bulk inserts in one transaction.

**Capacity and timeline.** When a `SprintMemberPlan` exists its `capacityHours` replaces the calculated capacity for that member in that sprint, so Load and Remaining match the sheet. The scheduler multiplies each task's available hours by `capacityHours ÷ calculated capacity` (efficiency), so meetings and vacation slow the timeline down. Dates, slips and overloads then fill in automatically from the hours.

**Standup.** `StandupEntry.off` / `offReason` mark a day off. Saving it clears the status, adds a one-day `Leave` whose note starts with `Off - daily standup` (so it can be found and removed when unticked; a leave added on the member's page is shown but left alone), and sets the same flag on the member's notes in other squads for that day. `StandupEntry.status` holds the status typed by hand (plus optional blockers). Entries saved in the earlier yesterday / today format are shown as one status and converted the first time they are edited. The date defaults to the date on the user's own clock.

### Azure DevOps sync (switched off)

The two-way sync is not part of `main`. It lives on the `azure-devops-sync` branch, which is `main` plus one commit that brings it back, and it is merged only after the IT and management approvals (see the approvals document). The database columns it uses (`LineOfBusiness.adoProject` / `adoLastSyncAt` / `adoLastResult`, `WorkItem.adoId` / `adoSnapshot`, `Sprint.adoPath`) stay in the schema, unused, so switching it on or off never needs a database change.

### Look and feel (ACT brand)

Taken from advancedcomputertechnology.com: primary `hsl(18 97% 57%)` = `#FC6A28` (the logo's colour), black and white, Poppins, `0.75rem` radius, an orange gradient for accents, dark text on orange buttons.
- `globals.css` replaces Tailwind's `orange` scale with the brand scale and `slate` with pure greys, so every existing `orange-*` / `slate-*` class follows the brand without touching each page.
- `ui/index.tsx` holds the shared look: `primaryButton`, `tabClass`, cards, tables, badges, stat tiles. New screens should use these instead of hard-coded colours.
- `sidebar-shell.tsx` (dark sidebar, logo, phone menu that closes when a page opens), `nav.tsx` (line icons), `app/login/page.tsx` (split brand panel).
- Assets: `public/brand/act-logo.png` (cropped from the site's logo), `app/icon.png` and `app/apple-icon.png`, fonts in `app/fonts` loaded with `next/font/local` (no network needed at build or run time). `proxy.ts` lets the brand images through when signed out so the login page can show them.

## 5. Capacity and scheduling algorithm

**Daily hours of a member in a squad**

```
isWorkingDay(d) = weekday(d) ∈ settings.workingDays AND d ∉ holidays
dailyHours(member, squad, d) =
    0                                                 if !isWorkingDay(d) or member on leave on d
    membership.weeklyHours / count(settings.workingDays)   otherwise
```

**Timeline.** For each member, take their open tasks in active and planned sprints, ordered by
sprint start → story rank → task rank. Fill each day's available hours from the earliest allowed
date (today or sprint start, whichever is later). A task's planned end is the day its estimate runs
out. Only availability matters; there are no task dependencies.

- Queues are per member and squad, so a member's hours are shared by every task in that squad, across all overlapping sprints.
- If a task ends after its deadline it is marked **slipped**. The deadline is the sprint end, or the baseline you accepted for that task.
- If the hours a member has in a sprint are more than their sprint capacity, they are marked **overloaded**.
- Nothing moves on its own. You choose: reassign, move to another sprint, re-estimate, or accept the new dates as the baseline.

## 6. Metric definitions

Hours "burn" only when a task becomes **Done**.

| Metric | Formula |
|---|---|
| Capacity | Σ sprint member capacity hours |
| Load | assigned open+done task hours ÷ capacity (per member and per squad) |
| Velocity | Σ estimate of tasks Done inside the sprint; plus average of the last 3 sprints |
| Commitment reliability | Done committed hours ÷ committed hours at sprint start |
| Scope change | (hours added + hours removed after start) ÷ committed hours |
| Carry-over | committed stories/bugs not Done at sprint end ÷ committed stories/bugs |
| Bug ratio | bug task hours ÷ total task hours |
| Cycle time | Story/Bug COMMITTED→DONE days; Task IN_PROGRESS→DONE days (from history) |
| Productivity (member) | Done hours ÷ member capacity in the period |
| Release forecast | remaining release hours ÷ average velocity → number of sprints → forecast date vs. target |
| Burndown | for each day: Σ estimates of sprint tasks not Done at the end of that day (tasks count from the day they entered the sprint, taken from history), with an ideal line from the committed hours down to 0 over the sprint's working days |

**Sprint Health Score (0–100)** (`sprintHealth` in `planning.ts`), green ≥ 80, amber 60–79, red < 60:

| Part | Weight | Score (0–100%) |
|---|---|---|
| Burndown on track | 30% | 1 − (remaining − ideal remaining today) ÷ committed, never below 0 |
| Commitment reliability | 25% | active sprint: done ÷ (committed × share of working days passed); closed sprint: done ÷ committed |
| Scope stability | 15% | 100% up to 10% scope change, falling to 0% at 40% |
| Load balance | 15% | 1 − (members assigned more than capacity ÷ members) |
| Blocked / slipped | 15% | 1 − (open tasks that are blocked or slipping ÷ open tasks) |

## 7. Security

- **Users, roles and permissions** (`User`, `Role`, `RolePermission`). Each user has one role; a role is a list of permission keys from
  `permissions.ts` (one group per page or feature, each with View and change permissions). The built-in **Administrator** role
  (`Role.builtIn`) has every permission and cannot be edited or deleted; the app always keeps one active administrator.
- **Passwords** are hashed with scrypt (`passwords.ts`, N=16384, r=8, p=1, 16-byte salt). Rules: 10–200 characters, not the user name.
  Unknown users are checked against a dummy hash so timing does not reveal user names; every failure gives the same message after a delay.
  An administrator sets a temporary password (`mustChangePassword`): until the user picks their own, only the profile page opens.
- **Sessions**: the cookie holds only the user id and `sessionVersion`, signed with HS256 (`SESSION_SECRET`). On every request
  `getCurrentUser()` reads the user and role from the database, so role changes apply at once and a disabled user is signed out.
  Changing or resetting a password raises `sessionVersion`, which ends every other session of that user.
- **Checks**: every Server Action starts with `requirePermission(...)`; every page with `requirePageAccess(...)` (redirects to the first
  page the role may open); every download checks the permission of its page. Screens follow with `RoleProvider` (read-only sections),
  `Can` (show a part only with a permission) and `useCan`. The server check is the real protection; hiding is only convenience.
- **First sign-in after the update**: when the user table is empty, `APP_PASSWORD` / `VIEWER_PASSWORD` become the first two users
  (Administrator and Viewer). After that those settings are not used.
- **Microsoft sign-in** (`sso.ts`, optional): OpenID Connect authorization code flow with PKCE against Microsoft Entra ID (single tenant).
  State, nonce and the PKCE verifier travel in a signed 10-minute cookie; the ID token is verified against Microsoft's published keys,
  issuer, audience, tenant and nonce. The account is matched to an active user by email; there is no automatic account creation.
  A temporary password is removed when its user signs in with Microsoft.
- Session cookie: `httpOnly`, `secure`, `sameSite=lax`, lasts 30 days.
- `proxy.ts` sends anyone without a valid session cookie to `/login` (the Microsoft sign-in routes are open).
- All database access goes through Prisma (no hand-built SQL), and all input is validated with Zod.
- Uploaded Excel files are limited to 2 MB and 1,000 rows, are only read (never executed), and nothing is imported if any row is invalid.

## 8. Environments and deployment

| Variable | Where | Purpose |
|---|---|---|
| `DATABASE_URL` | Vercel + local `.env` | Neon **pooled** connection string (used by the app) |
| `DIRECT_URL` | Vercel + local `.env` | Neon **direct** connection string (used for migrations) |
| `APP_PASSWORD` / `VIEWER_PASSWORD` | Vercel + local `.env` | First passwords of the two original accounts (used once) |
| `MS_ENTRA_TENANT_ID` / `MS_ENTRA_CLIENT_ID` / `MS_ENTRA_CLIENT_SECRET` / `APP_URL` | Vercel (optional) | Sign in with Microsoft |
| `SESSION_SECRET` | Vercel + local `.env` | Random string of 32+ characters |

**Vercel build** (`vercel.json`): `prisma migrate deploy` then `next build`. Database changes are applied
automatically on each deploy; migrations only add tables and columns. The Prisma engine includes
`rhel-openssl-3.0.x` for Vercel's Linux. `netlify.toml` is kept as an alternative host.

**Branches**: work happens on a feature branch, and `main` is what Vercel publishes.

**Backups**: Neon free has a short restore history, so *Import & Backup* downloads every table as one Excel file.

## 9. Local development

```bash
cp .env.example .env      # fill in values
npm install
npx prisma migrate dev    # create tables
npm run dev               # http://localhost:3000
npm test                  # unit tests (capacity, hierarchy, planning, import)
```
