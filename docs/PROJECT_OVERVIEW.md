# Solo Scrum — Project Overview

*Status as of 26 November 2026 · Owner and product sponsor: Khaled Elbauomy (Scrum Master, ACT)*

Solo Scrum is a web application the ACT Scrum Master uses to run three squads and their lines of business:
backlog, sprints, an automatic timeline, daily standup, releases and reports, following ACT's own process instead
of a general tool such as Jira or Azure DevOps. It is built, live on free cloud hosting, and has a second version
prepared for ACT's own servers on Microsoft SQL Server.

---

## 1. Current status

### 1.1 At a glance

| Area | Status |
|---|---|
| Core product (organization, backlog, sprints, board, timeline, standup, releases, reports, import, backup) | **Live** on Vercel + Neon |
| ACT branding (logo, black and orange, Poppins, phone layout) | **Live** |
| Users, roles and permissions, profile password change | **Live** (merged 8 Nov 2026, pull request #17) |
| Sign in with Microsoft (Entra ID single sign-on) | **Built, switched off** until ACT IT registers the app (approvals S-1 to S-5) |
| Version for ACT servers (Microsoft SQL Server) | **Built and tested** on branch `act-sqlserver`; users and roles for it are ready locally and waiting to be pushed |
| Azure DevOps two-way sync | **Built, switched off** and kept on branch `azure-devops-sync` until IT and management approve it (A-1 to A-10) |
| Standup captured automatically from Teams | **On hold**; needs approvals T-1 to T-5 and answers from the owner |

### 1.2 Versions and branches

| Branch | Database | Runs on | Contents |
|---|---|---|---|
| `main` | PostgreSQL (Neon, London) | Vercel, deployed automatically on every merge | Everything live today, including users and roles |
| `act-sqlserver` | Microsoft SQL Server 2017+ (tested on 2022) | ACT servers, deployed by ACT's DevOps engineer | Same product as `main` up to 8 Nov, adapted for SQL Server. Users and roles still to be added (see 1.3) |
| `azure-devops-sync` | PostgreSQL | Not deployed | `main` as of 7 Nov plus the Azure DevOps sync. Needs the later changes and the SQL Server adaptation before it can be merged |

Every change goes into both `main` and `act-sqlserver`. A change that touches the database needs its own
SQL Server migration, so it reaches `act-sqlserver` through a separate pull request.

### 1.3 Open actions

| # | Action | Who | Notes |
|---|---|---|---|
| 1 | Allow pushing the SQL Server version of users and roles to a new branch (`claude/sweet-hawking-8wympi-sqlserver`) and opening its pull request into `act-sqlserver` | Owner | Built and fully tested (188 browser checks on SQL Server); waiting for permission |
| 2 | Revoke the Azure DevOps access token that was pasted in chat on 3 November | Owner | Required whatever IT decides |
| 3 | Check Vercel settings: `APP_PASSWORD`, `VIEWER_PASSWORD` and `SESSION_SECRET` set; `ADO_ORG` and `ADO_PAT` removed | Owner | `APP_PASSWORD` and `VIEWER_PASSWORD` are only used once, to create the first two users |
| 4 | Send the approvals document to IT and ACT management and collect decisions | Owner | 24 requests in 4 groups, with a sign-off table |
| 5 | Prepare the ACT server: Node.js, SQL Server database, HTTPS, settings | ACT DevOps engineer | Steps in `docs/SQL_SERVER.md` on `act-sqlserver` |
| 6 | Decide whether to copy the current data from Neon or start empty on the ACT server | Owner + DevOps | Both options are described in `docs/SQL_SERVER.md` |

---

## 2. Background and goals

**Problem.** The Scrum Master manages three squads, each owning several lines of business (projects), with a delivery
process that does not fit standard Scrum tools. Sprint planning happens in a spreadsheet (the "Sonata" planning sheet),
the timeline is maintained by hand, and status, capacity and release dates are spread across files and Azure DevOps.

**Goals.**

1. One place for squads, lines of business, members, backlog, sprints, releases and standups.
2. A timeline that builds itself from the team's real availability and task hours.
3. The sprint planning sheet becomes the sprint in one upload, with no retyping.
4. Clear, exportable reports on sprint health, velocity, capacity and release risk.
5. Controlled access for colleagues, with roles and permissions.
6. No cost while used on free hosting, and a path to ACT's own servers.

**Users.**

| Who | How they use it |
|---|---|
| Scrum Master (owner, Administrator) | Runs everything: planning, daily follow-up, reports, users and roles |
| Squad members and supervisors | Can be given accounts with a role, for example to move cards or write standups |
| Managers and stakeholders | Read-only roles: dashboards, timeline, reports and downloads |
| ACT IT / DevOps | Hosts the SQL Server version and approves integrations |

---

## 3. Business requirements

### 3.1 Organization

| ID | Requirement |
|---|---|
| BR-01 | Squads, lines of business (LOBs) and members can be added, edited and deleted at any time. |
| BR-02 | A LOB is a project and belongs to exactly one squad. It has a short code (for example SON) used in item IDs. |
| BR-03 | Members are names (and an optional role label); they do not need to sign in. A member can belong to several squads with hours per week in each. |
| BR-04 | Supervisors shared across squads and LOBs can reserve part of their hours for a specific LOB. |
| BR-05 | Leave reduces a member's capacity. |
| BR-06 | Working days, hours per day, default sprint length and public holidays are set once in Settings. |

### 3.2 Work items

| ID | Requirement |
|---|---|
| BR-10 | Hierarchy: Epic → Feature → User Story or Bug → Task, with rules about what can sit under what. |
| BR-11 | Statuses: Story and Bug go New → Approved → Committed → Done; Task goes New → In Progress → Done. Epics and features show progress from their children. |
| BR-12 | A separate Blocked flag with a reason. |
| BR-13 | Estimates are in hours, on tasks only. A task's hours burn down when it is marked Done. |
| BR-14 | Priority High, Medium or Low, plus drag-to-rank among siblings. |
| BR-15 | Item IDs are the LOB code plus a number, for example SON-12. |
| BR-16 | Every change to an item is kept in its history. |
| BR-17 | The backlog can be filtered by squad, LOB, type, status, assignee, priority, blocked, missing estimate, text and dates. Many items can be deleted at once. |

### 3.3 Sprints and releases

| ID | Requirement |
|---|---|
| BR-20 | Each LOB runs its own sprints; sprint length can differ per squad and per LOB; sprints may overlap. |
| BR-21 | When sprints overlap, a member's hours are shared between them, with an optional percentage per member. |
| BR-22 | A sprint can be planned from the backlog, started (saving a commitment snapshot), edited, paused, resumed (optionally moving the end date out by the lost working days) and closed (saving results and carrying open stories over). |
| BR-23 | A release belongs to a LOB, contains several sprints and has a target date. Every change to the date is logged, and the release can be marked deployed. |
| BR-24 | The sprint planning sheet (Sonata layout, Excel or CSV) creates or updates the sprint, each member's capacity, the user stories and the tasks. Uploading again updates it without duplicates. |

### 3.4 Timeline and daily follow-up

| ID | Requirement |
|---|---|
| BR-30 | The timeline is built automatically from each assignee's availability and task hours only (no dependencies between tasks). |
| BR-31 | Slips and overloads are shown, but nothing changes until the Scrum Master acts: reassign, re-estimate, move to the next sprint or accept the new date. |
| BR-32 | A daily plan shows which story and task each member works on every day. |
| BR-33 | The sprint board shows cards by status; moving a card changes its status. |
| BR-34 | Daily standup: choose the squad and the date (today by default), type each member's status and blockers by hand, and mark a member as off for the day with a reason. History is filterable by squad, date and member. |

### 3.5 Reports, export and data

| ID | Requirement |
|---|---|
| BR-40 | Dashboard: active sprints, average health, overloaded members, blocked items and releases at risk, with filters. |
| BR-41 | Reports: sprint health, velocity, burndown, capacity and load, productivity, commitment/scope/bugs, cycle time and release forecast, all filterable. |
| BR-42 | Every report exports to Excel and to PDF (print); lists export to Excel. |
| BR-43 | A full backup of every table downloads as one Excel file. |
| BR-44 | Work items can be imported from an Excel template; nothing is imported if any row is invalid. |

### 3.6 Access, look and hosting

| ID | Requirement |
|---|---|
| BR-50 | Any member can be given a sign-in account. Users sign in with a user name or email and a password. |
| BR-51 | Each user has exactly one role. A role is a name plus a list of permissions, grouped by page or feature. Roles are managed in the app. |
| BR-52 | Users change their own password on their profile. Administrators give temporary passwords that must be changed at the first sign-in. |
| BR-53 | Optional sign-in with a Microsoft work account (single sign-on), subject to IT approval. |
| BR-54 | The app follows the ACT brand and works on phones. |
| BR-55 | English only. |
| BR-56 | Free to run while on cloud hosting; a version for ACT's servers on Microsoft SQL Server. |

### 3.7 Integrations (subject to approval)

| ID | Requirement |
|---|---|
| BR-60 | Two-way sync with Azure DevOps (organization `act-eg`), one project per LOB, on demand. Azure DevOps owns titles, descriptions and hierarchy; Solo Scrum owns hours, order and blocked flags; status, task assignee and story sprint go both ways with the latest change winning. Nothing is deleted, and items are never created in Azure DevOps. |
| BR-61 | Standup statuses captured automatically from the Teams standup meeting (on hold). |

---

## 4. Scope

### 4.1 In scope and built

All of BR-01 to BR-56 are built and live on `main`. BR-53 (Microsoft sign-in) and BR-60 (Azure DevOps sync) are built
but switched off until approved. BR-56's SQL Server version is built on `act-sqlserver`.

### 4.2 Out of scope (decided)

- Dependencies between tasks; the timeline uses availability only.
- Story points; estimates are hours only.
- Other languages than English.
- Creating or deleting items in Azure DevOps from Solo Scrum.
- Automatic changes to plans: slips are reported, and the Scrum Master decides.
- Paid AI services, for example to summarise standup meetings.

### 4.3 Not built yet (candidate next steps)

- Automatic standup capture from Teams (BR-61, on hold).
- Daily alerts (email or Teams) for slips, overloads, blocked items and releases at risk.
- Sprint retrospectives and action items; sprint review notes.
- Automated tests on GitHub for every change, and a scheduled automatic backup.
- A release planning view across all LOBs.
- Comments and attachments on items; search across everything.

---

## 5. Features by module

| Module | What it does |
|---|---|
| Dashboard | Health of active sprints, overloaded members, blocked items, release risk and forecast, with filters |
| Squads, Lines of Business, Members | Organization structure, squad hours, shared supervisor hours per LOB, leave, bulk delete, "Give sign-in access" |
| Backlog and item pages | Hierarchy, statuses, estimates, assignee, priority and ranking, blocked flag, history, filters, bulk delete, Excel export |
| Sprints | Per-LOB sprints, capacity and load, plan from backlog, start, pause and resume, edit, close with carry-over, commitment snapshot, planning-sheet import |
| Sprint Board | Cards by status with drag and drop, summary of done, capacity, load, remaining and blocked |
| Releases | Sprints per release, target and deployed dates, date-change log, forecast |
| Timeline | Automatic schedule, hours per member per day or week, slip and overload status, Scrum Master actions, daily plan, Excel export |
| Daily Standup | Status and blockers per member, "off today", history and filters |
| Reports | Eight reports with filters, Excel export and print to PDF |
| Settings | Working days, hours per day, default sprint length, holidays |
| Import & Backup | Work-item import from Excel, full backup to Excel |
| Users | Add users (from a member or not), role, email, temporary password, reset, disable, delete |
| Roles & Permissions | Create and edit roles with a grouped permission checklist; built-in Administrator role |
| Profile | Account details and password change |

### 5.1 Permission groups

| Page or feature | Permissions |
|---|---|
| Dashboard | View |
| Squads, Lines of Business, Members, Releases, Settings | View; add, edit and delete |
| Backlog and work items | View; add and edit; delete |
| Sprints | View; plan sprints; start, pause, resume and close; import planning sheets |
| Sprint Board | View; move cards |
| Timeline | View; act on slips |
| Daily Standup | View; write statuses |
| Reports | View; export to Excel |
| Import & Backup | Import work items; download the full backup |
| Users | Manage users |
| Roles | Manage roles and permissions |

The built-in **Administrator** role has every permission and cannot be changed. A starting **Viewer** role sees every
page and downloads reports and the backup. At least one active administrator always remains.

---

## 6. Main user flows

1. **First-time setup:** Settings → Squads → Lines of Business → Members → Users and Roles.
2. **Plan a sprint from the sheet:** Sprints → Import planning sheet → Check file → Import → review capacity → Start sprint. The timeline fills in automatically.
3. **Plan without a sheet:** Backlog (epic, feature, story, tasks with hours) → New sprint → add stories → check load → Start.
4. **Daily routine:** Daily Standup → Sprint Board → Timeline (slips and overloads) → act → Dashboard.
5. **Mid-sprint change:** Pause sprint with a reason → Resume, optionally moving the end date out.
6. **End of sprint:** Close sprint → Releases (target date, deployed) → Reports.
7. **Reporting and safety:** Reports → export; Import & Backup → download the full backup at each sprint end.
8. **Give a colleague access:** Member page → Give sign-in access → choose a role → share the temporary password → they choose their own at first sign-in.

---

## 7. Architecture and technology

| Layer | Choice |
|---|---|
| Application | Next.js 16 (App Router, Server Components, Server Actions), React 19, TypeScript, Tailwind CSS 4 |
| Data access | Prisma 6; Zod for input validation |
| Database | PostgreSQL 16 on Neon (live); Microsoft SQL Server 2017+ on ACT servers (`act-sqlserver`) |
| Charts and files | Recharts; ExcelJS for imports and exports |
| Sign-in | Own user table, scrypt password hashes, signed session cookie (jose, HS256); optional Microsoft Entra ID (OpenID Connect with PKCE) |
| Hosting (live) | Vercel (Hobby), Neon (Free, London), GitHub |
| Tests | Vitest unit tests (89 on `main`); Playwright browser suites run before each release |

**Data model.** 22 tables. Organization: Setting, Holiday, Squad, LineOfBusiness, Member, SquadMembership,
MemberLobAllocation, Leave. Delivery: WorkItem, WorkItemHistory, Sprint, SprintMemberShare, SprintCommitment,
SprintMemberPlan, SprintPause, TaskBaseline, Release, ReleaseDateChange, StandupEntry. Access: User, Role,
RolePermission. Database changes are additive migrations, so a deploy never removes data.

**Security.**

- Every page checks a view permission, and every action and download checks its own permission on the server; the screens only hide what the role cannot use.
- Sessions hold only the user ID and a version number. Permissions are read from the database on every request, so a role change applies at once; a password change or reset signs the user out elsewhere.
- One message for any failed sign-in, with a delay.
- Secrets live only in the hosting settings.
- In production the session cookie is HTTP-only and Secure, so the ACT server must use HTTPS.

**SQL Server version differences.**

- Fixed values (type, status, priority, sprint state) are stored as text.
- Working days are stored as text, and sprint results as JSON text.
- Columns whose names are reserved words are renamed in the database.
- `NO ACTION` is used instead of `RESTRICT`.
- Filtered unique indexes are used for a user's optional email and member link.

Details are in `docs/SQL_SERVER.md` on `act-sqlserver`.

---

## 8. Delivery history

| Date (2026) | Milestone |
|---|---|
| 1 Nov | Foundation: sign-in, settings, holidays, squads, LOBs, members |
| 2 Nov | Work items, backlog and filters; sprints, releases, board, timeline, standup, reports, exports, backup |
| 3 Nov | Shared supervisors across squads and LOBs; user names and a view-only account; ACT brand redesign |
| 5 Nov | Sprint planning-sheet import, member capacity per sprint, manual standup statuses |
| 6–7 Nov | Edit, pause and resume sprints; daily plan view; "off today" in standup; delete and bulk delete |
| 7 Nov | Azure DevOps sync built and tested read-only on the real SONATA project, then switched off in the live version pending approval |
| 8 Nov | SQL Server version created; two-version setup (`main` and `act-sqlserver`); users, roles, permissions, profile and Microsoft sign-in merged to `main` |

---

## 9. Quality

- **Unit tests:** 89 on `main` (planning, capacity, scheduling, pauses, planning-sheet reading, import, permissions, passwords, sessions); 125 on `azure-devops-sync`, including the sync rules.
- **Browser tests:** 188 checks pass on PostgreSQL and the same 188 on SQL Server 2022:
  - users and roles: 39;
  - view-only access: 68;
  - bulk delete: 24;
  - standup "off": 19;
  - pause and resume: 38.
- **Each release:** lint, type-check and build pass.
- **Gap:** the browser tests are run by hand before each release and are not stored in the repository, and nothing runs them automatically on GitHub.

---

## 10. Integrations and approvals

The approvals document (Claude Docs, shared from the owner's account) lists every request for IT and ACT management,
with a sign-off table:

| Group | IDs | Needed before |
|---|---|---|
| Azure DevOps sync | A-1 to A-10 | Merging `azure-devops-sync`: data copy approval, projects in scope, sync identity, access token, project permissions, fields written back, network rules, token storage, informing teams, offboarding |
| Live system today | L-1 to L-4 | Already in use: external free hosting (Vercel Hobby is for non-commercial use), ACT name and logo, view-only access, backups and retention |
| Teams standup capture | T-1 to T-5 | Building BR-61: note-taking approval, browser add-on, live captions, Teams on the web, or the Microsoft Graph alternative |
| Sign in with Microsoft | S-1 to S-5 | Switching on BR-53: app registration, sign-in permissions (`openid`, `profile`, `email`), client secret, tenant and client IDs, MFA and access rules |

Moving to ACT servers resolves L-1.

---

## 11. Risks and issues

| Risk or issue | Impact | Mitigation |
|---|---|---|
| Free hosting terms (Vercel Hobby is for personal, non-commercial use) | Medium | Move to ACT servers (`act-sqlserver`), or Vercel Pro |
| Short restore history on Neon Free; backups only when downloaded | High until on ACT servers | Download the backup each sprint end; IT backups on SQL Server; automatic backup is a candidate next step |
| No automatic tests on GitHub | Medium | Add continuous integration (lint, type-check, unit tests, build) |
| Two versions must be kept in step; database changes are done twice | Medium | Paired pull requests for every change; SQL Server migrations tested on a real SQL Server |
| `azure-devops-sync` falls further behind `main` | Low now, grows over time | Bring it up to date only when approvals arrive |
| An Azure DevOps access token was exposed in chat on 3 Nov | High until revoked | Revoke it now (open action 2) |
| Microsoft sign-in tested only against a simulated Entra ID | Low | First real sign-in after IT registers the app |

---

## 12. Recommended next steps

1. Close the open actions in section 1.3, especially pushing the SQL Server version of users and roles and revoking the token.
2. Send the approvals document; prepare the ACT server from `docs/SQL_SERVER.md`.
3. Add a safety net: automatic tests on GitHub and a scheduled backup.
4. After a sprint of real use, choose between daily alerts, retrospectives and action items, and the release planning view.
5. Return to Azure DevOps sync and Teams standup capture as approvals arrive.

---

## 13. References

| Item | Where |
|---|---|
| Source code | GitHub repository `elbauomy/solo_scrum` (formerly `act_scrum`) |
| Agreed decisions and phases | `docs/PRODUCT_PLAN.md` |
| Technical design, metric formulas, security | `docs/TECHNICAL_PLAN.md` |
| How to use the app | `docs/USER_GUIDE.md` |
| Running on ACT servers | `docs/SQL_SERVER.md` (branch `act-sqlserver`) |
| Two versions and deployment | `README.md` |
| Approvals for IT and management | Claude Docs: "Solo Scrum: IT and Management Approvals" |

**Settings (environment variables).**

| Name | Purpose |
|---|---|
| `DATABASE_URL` | Database connection; plus `DIRECT_URL` on Neon only |
| `SESSION_SECRET` | Signs the sign-in cookie |
| `APP_PASSWORD`, `VIEWER_PASSWORD` | Used once, to create the first two users |
| `MS_ENTRA_TENANT_ID`, `MS_ENTRA_CLIENT_ID`, `MS_ENTRA_CLIENT_SECRET`, `APP_URL` | Optional, Microsoft sign-in |
| `ADO_ORG`, `ADO_PAT` | Only on `azure-devops-sync` |
