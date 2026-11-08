# Solo Scrum — how to use it

A simple rhythm for running your squads. Every list has filters at the top; the page address keeps them, so you can bookmark a view.

## Signing in, users and roles
- **Sign in** with your user name (or work email) and password. Your name and role show at the bottom of the menu; click them to open **your profile**, where you change your password.
- **Users** (*Administration → Users*): add a user, give them a role and a temporary password, and optionally link them to a member. On a member's page, **Give sign-in access** does the same with the name filled in. A user with a temporary password must choose their own at the first sign-in. **Reset password** gives a new temporary password and signs them out everywhere. Untick **Can sign in** to disable an account without deleting it.
- **Roles** (*Administration → Roles & Permissions*): a role is a name plus a list of permissions, grouped by page (Squads, Backlog, Sprints, Sprint Board, Timeline, Standup, Reports, Settings, Import & Backup, Users, Roles…). Each user has exactly one role. Giving any permission on a page also gives "View" on it. Changes apply at once, without signing in again.
- **Administrator** is built in: it has every permission and cannot be changed. The system always keeps at least one active administrator, and nobody can disable or delete their own account.
- The menu only shows the pages your role may open, and the system refuses any change your role does not allow, even if someone tries to force it.
- The first sign-in after this update turned the two earlier accounts into users: **khaled elbauomy** (Administrator) and **remoon milad** (Viewer), with their existing passwords.

## Sign in with Microsoft (optional)
When it is switched on, the login page shows **Sign in with Microsoft**. It matches the Microsoft account to a user by **work email**, so add each person's email on their user first; nobody gets in just by having a Microsoft account. To switch it on, ACT's IT registers the app in Microsoft Entra ID (see the approvals document) and gives four values to put in the hosting settings: `MS_ENTRA_TENANT_ID`, `MS_ENTRA_CLIENT_ID`, `MS_ENTRA_CLIENT_SECRET`, and `APP_URL` (this site's address). The redirect address to register is `APP_URL` followed by `/api/auth/microsoft/callback`.

## One-time setup
1. **Settings** — tick your working days, set hours per day, the default sprint length, and add public holidays.
2. **Squads** → **Lines of Business** (each belongs to one squad and gets a short code such as `RB`) → **Members** (name, role, hours per week in each squad, and leave).

### Supervisors who share their time
Open the member and add them to every squad they work in, with hours per week for each. Under **Split across lines of business** you can reserve hours for individual lines (for example 24 h for RB and 10 h for CB inside a 40 h squad). The hours you don't reserve (6 h here) are shared by all of the squad's lines through the sprints that overlap. Sprint capacity, the board, the timeline and the reports all use this split.

## Planning a sprint from your planning sheet
1. Hold sprint planning with your sheet as usual.
2. **Sprints → Import sprint planning**, choose the file (`.xlsx` or `.csv`) and click **Check the sheet**. You see the sprint, every member's capacity, and each story with its tasks, before anything is saved. Read the yellow notes.
3. Click **Import into the system**. The sprint, each member's capacity (the sheet's *Final Buffer*), the user stories and their tasks are created.
4. Open the **Timeline**: the planned dates of every task are filled in from the hours and each person's availability.
5. If planning changes, edit the sheet and import it again: the same sprint is updated, changed hours are applied, and nothing is deleted.

## Before a sprint (without a sheet)
1. **Backlog** — create epics, features, stories/bugs and tasks. Give every task an assignee and hours.
2. **Sprints → New sprint** — pick the line of business. The end date follows the sprint length (line of business, then squad, then default).
3. Open the sprint and **Add to sprint** the stories and bugs. Their tasks come with them. Watch **Capacity and load**: aim for 70–100% per member.
4. If another sprint of the same squad overlaps, each member's hours are shared between them. Set a percent next to a member to change the split.
5. **Start sprint** — this saves the committed hours. Later changes show up as scope change.

## When the team has to stop (pause a sprint)
Open the sprint → **Sprint status** → **Pause sprint**, choose the day it stopped and add the reason. While paused, its tasks are left out of the timeline and the sprint takes no share of anyone's hours. When work starts again, choose **Resume sprint**: tick *Move the end date out* to give the team back the working days they lost. The sprint page keeps a list of every pause. **Edit sprint** (button at the top of the sprint page, or *Edit* in the sprint list) changes the name, dates, goal and release.

## Azure DevOps
The Azure DevOps sync is switched off in this version until IT and ACT management approve it. It is kept on the `azure-devops-sync` branch and comes back with one merge.

## Cleaning up (delete one or many)
- **Members**: each row has a **Delete** button, and you can tick several rows (or *Select all*) and click **Delete selected**. Their tasks stay and become unassigned; their squad hours, leave, sprint capacity and standup notes are removed.
- **Sprints**: tick planned sprints and click **Delete selected**. Their stories and bugs go back to the backlog. Active, paused and closed sprints cannot be ticked because they hold history.
- **Backlog**: tick items (ticking a story, feature or epic also ticks everything under it) and click **Delete selected**. An item with children is only deleted when all of its children are ticked too; otherwise it is kept and listed.
Everything asks for confirmation first, and deleting cannot be undone, so download a backup from *Import & Backup* before a big clean-up.

## Every day
- **Daily Standup** — choose the squad and the date (today is selected for you), then type each person's status and Save. If someone is not working that day, tick **Off today** on their card (with an optional reason): their status boxes are hidden, the top of the page shows who is present and who is off, and a day of leave is added so capacity and the timeline plan around it. Unticking removes that leave again. *Add task activity to the status* inserts what they finished and have in progress, if you want it.
- **Sprint Board** — drag tasks between New / In Progress / Done. Switch to *Columns: member* and drag a task to reassign it.
- **Timeline → Daily plan** — shows, for each person and each day, the user story and the tasks they work on, and what they finished. Use *Today* for the day's agenda or *This week* for the whole team's week.
- **Timeline → Hours per member** — shows who is busy when, and which tasks would finish after their deadline. For each slip choose: reassign, change the hours, move the story to the next sprint, or **Accept new date** (it becomes the baseline).

## End of a sprint
1. **Close sprint** — choose where unfinished stories and bugs go (next sprint or backlog). Finished tasks stay in the closed sprint, and its numbers are saved.
2. **Reports** — look at Sprint health, Velocity, Commitment/scope/bugs and Cycle time. Use **Export** for Excel or **Save as PDF** to share.
3. **Releases** — attach sprints, record the real deployment date, and change the target date with a reason when it moves.
4. **Import & Backup** — download a full backup now and then.

## Health score at a glance
Green 80+, amber 60–79, red below 60. The five parts and their weights are on the sprint page and the dashboard.
