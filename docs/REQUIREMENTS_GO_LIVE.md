# Solo Scrum — Go-live scope: requirements for development

*Agreed 26 November 2026 · Owner and product sponsor: Khaled Elbauomy (Scrum Master, ACT)*

Save this file in the repository as `docs/REQUIREMENTS_GO_LIVE.md` and work from it. Read `README.md`,
`docs/PRODUCT_PLAN.md`, `docs/TECHNICAL_PLAN.md` and, on branch `act-sqlserver`, `docs/SQL_SERVER.md` before starting.

---

## 1. Context

- Solo Scrum goes live on **ACT's own server**, on **Microsoft SQL Server** (branch `act-sqlserver`), with an **empty
  database**. No data is copied from Neon.
- `main` (PostgreSQL on Neon, deployed to Vercel) stays live until go-live.
- Sign-in at go-live is **local user name and password only**. Microsoft sign-in (BR-53) stays built and switched off.
- This file covers five requirements: **BR-57, BR-58, BR-37, BR-28, BR-61**. Everything in section 12 is out of scope:
  do not build it.

---

## 2. Rules for every change

1. **Two versions.** Every requirement lands on `main` and on `act-sqlserver`. A change that touches the database needs
   a PostgreSQL migration on `main` and its own SQL Server migration on `act-sqlserver`, tested on a real SQL Server 2022.
   One pull request per requirement on `main`, and its paired pull request on `act-sqlserver`.
2. **Additive migrations only.** Never drop a column or table. When a field is no longer used, stop reading and writing
   it and remove it from the screens.
3. **Server-side permission checks.** Every new page checks its view permission and every new action, download and
   endpoint checks its own permission on the server, as the existing code does. Screens only hide what a role cannot use.
4. **Validation** with Zod, as elsewhere in the code.
5. **English only, ACT brand, works on phones**, like the existing pages.
6. **Dates and "today"** use Africa/Cairo time. If the code already has a time-zone rule, use it.
7. **Secrets** live only in environment variables, never in the database or in logs.
8. **Tests.** Unit tests (Vitest) for every rule and calculation listed under each requirement. Browser checks for each
   requirement run on PostgreSQL and on SQL Server 2022 before each pull request; list the results in the pull request.
   Lint, type-check and build must pass.

---

## 3. Build order and go-live gate

| Step | Work | Blocks go-live |
|---|---|---|
| 0 | Push the SQL Server version of users and roles (section 4) | Yes |
| 1 | BR-57 Audit log | Yes |
| 2 | BR-58 Sign-in protection (writes to the audit log) | Yes |
| 3 | BR-37 Attendance | Yes |
| 4 | BR-28 Sprint report (uses BR-37) | Yes |
| 5 | BR-61 phase 1: fill standup from an uploaded transcript file | No |
| 6 | BR-61 phase 2: fetch transcripts from Microsoft Graph, switched off until IT approves | No |

Go-live happens when steps 0 to 4 are merged into `act-sqlserver` and deployed.

---

## 4. Step 0 — Prerequisite

Users, roles and permissions for SQL Server are built and tested (188 browser checks on SQL Server) on the local branch
`claude/sweet-hawking-8wympi-sqlserver`. Push it and open its pull request into `act-sqlserver`; handing over this file
is the owner's approval. If the branch is not available in your environment, stop and tell the owner before building
anything on `act-sqlserver`.

---

## 5. BR-57 Audit log

**Requirement.** Security and administration actions are recorded in a log that administrators can read and export but
nobody can change from the app.

### 5.1 What is recorded

| Action code | When |
|---|---|
| `SIGN_IN_SUCCESS` | A user signs in |
| `SIGN_IN_FAILED` | A sign-in fails (wrong password, unknown user name, disabled or locked account) |
| `ACCOUNT_LOCKED` | An account locks after too many failed sign-ins (BR-58) |
| `ACCOUNT_UNLOCKED` | An administrator unlocks an account |
| `SIGN_OUT` | A user signs out |
| `SESSION_EXPIRED` | A session ends after the idle time (BR-58) |
| `PASSWORD_CHANGED` | A user changes their own password, including at first sign-in |
| `PASSWORD_RESET` | An administrator sets a temporary password |
| `USER_CREATED`, `USER_UPDATED`, `USER_DISABLED`, `USER_ENABLED`, `USER_DELETED` | User changes; `USER_UPDATED` includes a role change |
| `ROLE_CREATED`, `ROLE_UPDATED`, `ROLE_DELETED` | Role changes |
| `ROLE_PERMISSIONS_CHANGED` | Permissions added to or removed from a role |
| `SETTINGS_CHANGED` | Any change in Settings, including the sign-in security values (BR-58) |
| `BACKUP_DOWNLOADED` | The full backup is downloaded |
| `WORK_ITEMS_IMPORTED` | A work-item import completes |
| `PLANNING_SHEET_IMPORTED` | A sprint planning sheet import completes |
| `BULK_DELETE` | Any bulk delete (type of record and count) |
| `STANDUP_FILLED_FROM_TEAMS` | A standup is filled from a transcript (BR-61) |
| `TEAMS_FETCH_FAILED` | A transcript fetch from Microsoft Graph fails (BR-61) |
| `AUDIT_LOG_EXPORTED` | The audit log is exported |

### 5.2 Each entry holds

Date and time (stored in UTC, shown in Cairo time); the signed-in user (empty for a failed sign-in); the user name as
typed for a failed sign-in (first 100 characters); the action code; the type, ID and name of the record affected; details
as JSON text, with before and after values for changes; and the client IP address when the server receives one.

Never write passwords, password hashes, session tokens or secrets into an entry.

### 5.3 Writing entries

Write the entry in the same database transaction as the action where the action already uses one; otherwise straight
after it. If writing the entry fails, the user's action still completes and the error goes to the server log.

### 5.4 Work item and standup history

Check that every work item history row records the signed-in user who made the change. Add it where missing (empty for
older rows). Standup entries record who last edited them (BR-61).

### 5.5 Audit log page

- New page **Audit log**, in the same menu area as Users and Roles.
- Newest first, 50 per page. Filters: date from and to (default: last 7 days), user, action.
- Opening an entry shows its details, with before and after values side by side.
- Export the filtered entries to Excel (records `AUDIT_LOG_EXPORTED`).
- No edit or delete anywhere in the app. Entries are never removed automatically.
- The audit log table is included in the full backup (BR-43).

### 5.6 Permission

New group **Audit log**: *View and export*. The Administrator role has it; the Viewer role does not.

### 5.7 Unit tests

Entry built for each action code; no password or secret ever appears in details; failed sign-in stores the typed user
name truncated to 100 characters; filters by date, user and action.

---

## 6. BR-58 Sign-in protection

**Requirement.** Passwords follow a minimum rule, accounts lock after repeated failed sign-ins, and idle sessions end.

### 6.1 Settings

New section **Sign-in security** in Settings (needs the existing Settings edit permission; every change is audited):

| Setting | Default | Allowed |
|---|---|---|
| Minimum password length | 8 | 8 to 64 |
| Failed sign-ins before the account locks | 5 | 3 to 10 |
| Lock duration (minutes) | 15 | 5 to 1440 |
| End session after this many minutes without activity | 120 | 15 to 720 |

### 6.2 Password rule

- At least the minimum length, at least one letter and at least one number, and different from the user's current
  password.
- Applies when a user changes their own password (including the forced change at first sign-in), when an administrator
  creates a user and when an administrator sets a temporary password.
- Existing passwords are not forced to change; the rule applies at the next change.
- The rule is shown in plain words under every password field, for example: "At least 8 characters, with letters and
  numbers."

### 6.3 Lockout

- Each user keeps a count of failed sign-ins in a row. When it reaches the setting, the account locks until now plus
  the lock duration, and `ACCOUNT_LOCKED` is recorded.
- While locked, sign-in fails even with the right password.
- Every failed sign-in shows the same message, keeping the existing delay: "Sign-in failed. Check your user name and
  password. After 5 failed attempts the account is locked for 15 minutes." (numbers from Settings).
- A successful sign-in resets the count. Failed attempts with an unknown user name are audited but change no count.
- **Users page:** a locked user shows "Locked until hh:mm" and an **Unlock** action (existing *Manage users*
  permission). Unlocking resets the count and records `ACCOUNT_UNLOCKED`. Setting a temporary password also unlocks.

### 6.4 Idle timeout

- Each request renews the session. When the idle time passes with no request, the session ends; the next request goes
  to the sign-in page with the message "Your session ended after 120 minutes without activity." (number from Settings),
  and `SESSION_EXPIRED` is recorded.
- The existing rules stay: sessions hold only the user ID and a version number; a password change or reset signs the
  user out elsewhere.

### 6.5 Data

User: failed sign-in count (number, default 0), locked until (date and time, empty). Settings: the four values in 6.1.

### 6.6 Unit tests

Password rule (length, letter, number, same as current); count increments, locks at the setting, rejects the right
password while locked, unlocks after the duration, resets on success and on unlock; idle timeout ends the session at
the limit and renews on each request; settings outside the allowed range are rejected.

---

## 7. BR-37 Attendance

**Requirement.** Track each member's working days and absence days without recording any reason. ACT's HR system holds
reasons; Solo Scrum does not.

### 7.1 Marking a member off

- The standup page keeps its **Off** checkbox per member. When ticked, choose **Full day** (default) or **Half day**.
- The **reason field is removed** from the standup screens. Stop writing it; leave the column in place (rule 2.2). If
  the leave form on the member page has a reason or note field, remove it from the screens the same way.
- Off applies to the member for that date in every squad: ticking it in one squad's standup shows it ticked in the
  member's other squads for that date, and unticking it anywhere unticks it everywhere.
- Off can only be ticked on working days. On days that are not working days in Settings, or are public holidays, the
  checkbox is disabled.
- A member off for a full day has their status and blockers fields disabled for that date. A half day leaves them
  enabled.
- **Capacity and timeline:** check how the Off checkbox affects capacity and the timeline today and keep that
  behaviour. Where it removes a day's hours, a half day removes half of them.
- Leave entered on the member page (BR-05) is unchanged and is not counted in attendance.

### 7.2 Calculations (for one member and one period)

| Measure | Rule |
|---|---|
| Working days | Dates in the period that are working days in Settings and are not public holidays |
| Full days off | Working days marked Off, Full day |
| Half days off | Working days marked Off, Half day |
| Absence days | Full days off + 0.5 × half days off |
| Days worked | Working days − absence days |
| Attendance % | Days worked ÷ working days × 100, one decimal place; shown as "–" when there are no working days |

### 7.3 Attendance report (new, on the Reports page)

- **Period:** by sprint (choose LOB, then sprint; the period runs from the sprint's start date to its end date,
  including any end date moved on resume) or by month (choose the month).
- **Filters:** squad, member.
- **Members listed:** by sprint, the members with capacity in that sprint; by month, the members of the chosen squad,
  or every member when no squad is chosen.
- **Columns:** Member, Squads, Working days, Full days off, Half days off, Absence days, Days worked, Attendance %.
  A totals row at the bottom.
- Opening a member's row lists the dates they were off, each marked Full day or Half day.
- Export to Excel and print to PDF, like the other reports. Uses the existing Reports permissions.

### 7.4 Capacity report

Add an **Absence days** column for the sprint or period the report shows.

### 7.5 Unit tests

The calculations in 7.2, including half days, holidays, non-working days and a period with no working days; Off
shared across a member's squads for the same date; Off rejected on non-working days.

---

## 8. BR-28 Sprint report

**Requirement.** One report per sprint that gives the whole sprint in one place, ready to send after the sprint or
during it.

### 8.1 Where it opens

- A **Sprint report** button on every active or closed sprint's page.
- **Sprint report** on the Reports page, with LOB and sprint filters.
- Needs the existing *Reports: View* permission; exporting needs *Reports: Export to Excel*.
- For an active sprint every number is "as of" today, and the report says so in its header.

### 8.2 Numbers

Use the definitions already used by the Velocity, Burndown, Capacity and load, and Commitment/scope/bugs reports
(`docs/TECHNICAL_PLAN.md`). The same sprint must show the same numbers in this report and in those reports. Add the new
definitions to `docs/TECHNICAL_PLAN.md`.

### 8.3 Sections, in this order

Every section always appears; when it has no rows it says "None".

1. **Header.** LOB, squad, sprint name, planned start and end dates, actual end date when moved by a resume, state
   (Active as of today, or Closed), release name and target date, date and time generated, and who generated it.
2. **Summary**, as figures:

   | Figure | Meaning |
   |---|---|
   | Committed hours | Task hours in the commitment snapshot saved when the sprint started |
   | Completed hours | Hours of tasks marked Done in the sprint |
   | Completion % | Completed hours ÷ committed hours × 100, one decimal place |
   | Hours added after start | Hours of tasks added to the sprint after it started |
   | Hours removed after start | Hours of tasks removed from the sprint after it started |
   | Carried over | Number of stories not Done, and their open task hours |
   | Bugs | Bugs created during the sprint, and bugs Done during the sprint |
   | Blocked items | Items that were blocked at any time during the sprint |
   | Absence days | Total absence days of the sprint's members (BR-37) |
   | Pauses | Number of pauses and working days lost |

3. **Stories.** ID, title, task assignees, committed hours, completed hours, open hours, status, added after start
   (Yes/No), carried over (Yes/No), blocked during the sprint (Yes/No).
4. **Scope change.** Items added after the start and items removed after the start, each with date and hours; tasks
   re-estimated after the start, with old and new hours (from the task baselines).
5. **Team capacity and attendance.** Per member: capacity hours in the sprint, assigned hours, load %, completed hours,
   full days off, half days off, absence days, days worked (BR-37).
6. **Bugs.** ID, title, parent story, status, created in the sprint (Yes/No), Done in the sprint (Yes/No).
7. **Blocked items.** ID, title, blocked reason, date blocked, date unblocked (or "Still blocked"), working days
   blocked. Built from work item history.
8. **Pauses.** Start, end, reason, working days lost, and whether the end date was moved.
9. **Carry-over.** Stories not Done with their open task hours. For a closed sprint, the sprint they moved to; for an
   active sprint the section is titled "Open stories".
10. **Velocity trend.** Completed hours for this LOB's last five sprints, ending with this one.

### 8.4 Export

- **Excel:** a workbook with a *Summary* sheet (header, summary figures and velocity trend) and one sheet for each of
  sections 3 to 9.
- **PDF:** the print view of the whole report, like the other reports.

### 8.5 Unit tests

Each summary figure on a sprint with added, removed and re-estimated tasks, a pause, a blocked item, half and full days
off, and carried-over stories; numbers match the existing reports for the same sprint; empty sections show "None".

---

## 9. BR-61 Standup filled from the Teams transcript

**Requirement.** The daily standup is filled from the transcript of the squad's Teams standup meeting. Each member's
words become their status, members who didn't speak get "No update", blockers stay manual, and users with the right
permission correct any wrong text.

Phase 1 can be built and used now, with no IT approval. Phase 2 needs IT approvals and stays switched off until its
settings exist. Neither phase blocks go-live.

### 9.1 Fill rules (both phases)

1. **Read the transcript (WebVTT).** Accept files that start with `WEBVTT` (ignore a byte-order mark). Each cue has an
   optional identifier line, a timing line (`start --> end`, with or without hours, for example `0:0:0.0 --> 0:0:5.320`
   or `00:00:03.120 --> 00:00:07.450`) and text lines. The speaker is in the voice tag: `<v Speaker Name>text</v>`; the
   closing tag may be missing and text may run over several lines. Ignore cues without a speaker, remove any other tags,
   decode HTML entities and collapse white space.
2. **Each speaker's text** is everything they said, in time order, joined with single spaces.
3. **Match speakers to members.** Members get a new optional field, **Teams name**: their display name exactly as it
   appears in Teams. Match ignoring case and extra spaces, first on Teams name, then on member name. Only members of the
   chosen squad are candidates.
4. **Speakers not matched** are listed after the fill, with how many words each said. For each one the user chooses a
   member, which saves that name as the member's Teams name for next time, or **Ignore**, which adds it to the squad's
   ignored speakers list (for example the facilitator). Ignored speakers are skipped silently afterwards; the list can
   be edited on the squad page.
5. **For every member of the squad on that date:**
   - Off for a full day (BR-37): skip; no status.
   - Spoke: status = their text, marked as coming from Teams.
   - Did not speak: status = **No update**, marked as coming from Teams.
   - Blockers are never filled; they are set by hand.
6. **Never overwrite people's work.** Only entries that came from Teams and have not been edited are replaced when
   the fill runs again. Typed or edited entries stay as they are. Running the fill twice gives the same result.
7. **Keep the original.** Each filled entry stores the transcript text, when it was filled and from where (uploaded
   file or Microsoft Graph). When someone edits it, store who and when. The standup shows a **From Teams** or
   **Edited** badge, and **Show transcript text** displays the original.
8. **English only.** A status filled from Teams that contains Arabic letters (Unicode ranges U+0600–U+06FF,
   U+0750–U+077F, U+08A0–U+08FF, U+FB50–U+FDFF, U+FE70–U+FEFF) is flagged **Needs English** and highlighted. The
   standup page header shows how many entries are flagged for the chosen squad and date. Saving a status or blocker by
   hand that contains Arabic letters is refused with the message "Write the status in English." This applies to all
   standup entries, typed or filled.
9. **Length.** The status field must hold the full text. Check its column size in both schemas and widen it if needed
   (on SQL Server, `nvarchar(max)`).
10. **Record each fill** per squad and date: time, source, result, and counts (speakers found, matched, ignored, not
    matched; members filled, "No update", off; entries flagged Needs English). The squad's standup page shows the last
    fill for the chosen date. Each fill is audited as `STANDUP_FILLED_FROM_TEAMS` (BR-57).

### 9.2 Phase 1 — Fill from an uploaded transcript file

- On the standup page, for the chosen squad and date: **Fill from transcript** → upload a `.vtt` file downloaded from
  the Teams meeting. Other file types are refused with "Download the transcript from Teams as a .vtt file." Maximum
  size 5 MB.
- The fill rules in 9.1 apply; the results summary from 9.1.10 appears straight after.
- This stays available after phase 2, as a fallback.

**Owner's test (go or no-go).** For five working days in a row the facilitator starts transcription in the standup
meeting, with the meeting's spoken language set to English, downloads the `.vtt` file and uploads it. The owner times
how long the corrections take. **Go** if every speaker is matched after the first day's mapping and correcting is faster
than typing by hand on at least four of the five days. **No-go:** phase 2 is not built and the owner looks for another
way to automate the standup.

### 9.3 Phase 2 — Fetch from Microsoft Graph (switched off until approved)

**Switch.** On only when `TEAMS_TENANT_ID`, `TEAMS_CLIENT_ID`, `TEAMS_CLIENT_SECRET` and `TEAMS_ORGANIZER_USER_ID`
are all set. When off, the fetch button, the squad meeting fields and the job endpoint are hidden or return 404;
phase 1 keeps working.

**Squad settings** (squad page, existing edit permission):

- **Standup meeting link:** the Teams join link of the squad's standup meeting.
- **Organizer user ID:** the organizer's Microsoft Entra object ID. Optional; defaults to `TEAMS_ORGANIZER_USER_ID`.
- **Fetch after:** a local time (for example 10:30), used by the scheduled job.

**Microsoft Graph calls** (v1.0, app-only, client credentials, scope `https://graph.microsoft.com/.default`):

1. Find the meeting once and keep its ID on the squad:
   `GET /users/{organizerId}/onlineMeetings?$filter=JoinWebUrl eq '{URL-encoded join link}'`.
   Find it again when the link changes.
2. List transcripts: `GET /users/{organizerId}/onlineMeetings/{meetingId}/transcripts`. Use the transcripts whose
   `createdDateTime` falls on the standup date in Cairo time. When there are several (transcription stopped and
   started again), use them all, oldest first, as one transcript.
3. Get each transcript's text:
   `GET /users/{organizerId}/onlineMeetings/{meetingId}/transcripts/{transcriptId}/content?$format=text/vtt`.
   Then apply the fill rules in 9.1.

**On demand.** A **Fetch from Teams** button on the standup page for the chosen squad and date.

**Scheduled.** Endpoint `POST /api/jobs/standup-fetch`, protected by the header `X-Job-Secret` matching `JOB_SECRET`.
ACT's DevOps engineer schedules it every 15 minutes on the ACT server. On each working day, for each squad with a
meeting link, after its "Fetch after" time and until the end of the day, it fetches the day's transcript if that squad
and date have no successful fetch yet. Days that are not working days or are public holidays are skipped.

**Errors** are shown in plain words on the standup page, recorded in the fill record and audited as
`TEAMS_FETCH_FAILED`, and never stop the page or the job:

| Case | Message |
|---|---|
| Settings missing | "Fetching from Teams isn't set up." |
| Meeting not found | "The standup meeting link wasn't found in Teams. Check the link on the squad page." |
| No transcript yet | "No transcript for this date yet. Start transcription in the meeting, or try again later." |
| 401 or 403 from Graph | "Teams refused access. Ask IT to check the app's permissions and access policy." |
| Any other error | "Fetching from Teams failed. Try again, or upload the transcript file." |

**Testing.** Build and test phase 2 against a simulated Microsoft Graph, the same way Microsoft sign-in was tested
against a simulated Entra ID. The first real fetch happens after IT approves.

**What IT provides (for the approvals document):**

1. Transcription allowed for the standup organizer in ACT's Teams meeting policy.
2. An app registration with the application permissions `OnlineMeetings.Read.All` (to find the meeting) and
   `OnlineMeetingTranscript.Read.All` (to read transcripts), with admin consent.
3. A Teams application access policy for that app, granted **only to the standup organizer's account**.
4. Tenant ID, client ID, client secret and the organizer's user object ID, given to the DevOps engineer as server
   settings.
5. Outbound HTTPS from the ACT server to `login.microsoftonline.com` and `graph.microsoft.com`.

### 9.4 Permissions (Daily Standup group)

| Permission | Allows |
|---|---|
| View | Unchanged |
| Write and correct statuses | The existing "write statuses" permission, renamed. Write or edit any member's status and blockers, including correcting statuses filled from Teams. Can be given to any role |
| Fill from Teams | New. Upload a transcript, fetch from Teams, map or ignore speakers |

The Administrator role has all three; the Viewer role has View only.

### 9.5 Unit tests

The WebVTT reader on both timing formats, cue identifiers, multi-line cues, missing `</v>`, entities and cues without a
speaker; merging a speaker's text; matching by Teams name and member name, ignoring case and spaces; ignored speakers;
"No update"; full-day off skipped; half-day off filled; re-running does not overwrite typed or edited entries; Arabic
detection and refusal; choosing transcripts by Cairo date; each error case in 9.3; job secret check.

---

## 10. Permissions summary

| Page or feature | Change |
|---|---|
| Audit log | New group: View and export (BR-57) |
| Daily Standup | "Write statuses" renamed "Write and correct statuses"; new "Fill from Teams" (BR-61) |
| Users | Unlock is part of the existing *Manage users* (BR-58) |
| Settings | Sign-in security is part of the existing Settings edit permission (BR-58) |
| Reports | Attendance and Sprint report use the existing Reports permissions (BR-37, BR-28) |
| Squads, Members | Teams name, meeting link, organizer, fetch time and ignored speakers use the existing edit permissions (BR-61) |

---

## 11. Data changes summary

Each change needs a PostgreSQL migration on `main` and a SQL Server migration on `act-sqlserver`.

| Table | Change | For |
|---|---|---|
| New: audit log | Entries described in 5.2 | BR-57 |
| User | Failed sign-in count; locked until | BR-58 |
| Setting | Minimum password length; failed sign-ins before lock; lock minutes; idle minutes | BR-58 |
| Standup (or a new member-and-date table) | Off as full or half day, per member and date across squads; reason no longer used | BR-37 |
| Member | Teams name | BR-61 |
| Squad | Standup meeting link; organizer user ID; meeting ID found in Graph; fetch-after time; ignored speakers | BR-61 |
| StandupEntry | Source (typed or Teams); transcript text; filled at; edited by; edited at; status field wide enough | BR-61 |
| New: transcript fill record | Squad, date, time, source, result, counts | BR-61 |
| WorkItemHistory | User who made the change, if missing | BR-57 |

---

## 12. Out of scope — do not build

- Sprint Goal (BR-25), retrospectives (BR-26), sprint review (BR-27), impediment log (BR-35), members writing their own
  standup (BR-36), acceptance criteria (BR-18), Definition of Ready and Done (BR-19), cumulative flow diagram (BR-45),
  work item age (BR-46).
- Absence reasons of any kind, and any link to ACT's HR system.
- Filling blockers from the transcript; translating speech; any AI service.
- Switching on Microsoft sign-in (BR-53) or Azure DevOps sync (BR-60).
- Copying data from Neon to the ACT server.

---

## 13. Settings (environment variables) added

| Name | Purpose |
|---|---|
| `TEAMS_TENANT_ID`, `TEAMS_CLIENT_ID`, `TEAMS_CLIENT_SECRET` | BR-61 phase 2: the app registration IT creates for reading transcripts |
| `TEAMS_ORGANIZER_USER_ID` | BR-61 phase 2: default organizer's Microsoft Entra object ID |
| `JOB_SECRET` | BR-61 phase 2: protects the scheduled fetch endpoint |

All optional. Without them, phase 2 stays switched off.

---

## 14. Documents to update with each pull request

- `docs/USER_GUIDE.md`: the new pages, buttons and rules, in plain words.
- `docs/TECHNICAL_PLAN.md`: the attendance and sprint report definitions, the audit log, lockout and idle timeout, and
  the transcript fill rules.
- `docs/SQL_SERVER.md` (on `act-sqlserver`): the new migrations, the new settings and how to schedule the fetch job on
  the ACT server.
- `README.md`: the new settings.

---

## 15. Definition of done (each requirement)

- Built on `main` and on `act-sqlserver`, with both migrations.
- Unit tests listed under the requirement pass, along with all existing ones.
- Browser checks pass on PostgreSQL and on SQL Server 2022, listed in the pull request.
- Lint, type-check and build pass.
- Documents in section 14 updated.
- Every new page, action, download and endpoint checks its permission on the server.
