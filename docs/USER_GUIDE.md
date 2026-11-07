# Solo Scrum — how to use it

A simple rhythm for running your squads. Every list has filters at the top; the page address keeps them, so you can bookmark a view.

## Signing in (two accounts)
Sign in with a user name and a password. **khaled elbauomy** is the owner and can do everything. **remoon milad** is a view-only account: it can open every page, use the filters, and download reports and the backup, but cannot create, edit, delete, import or move anything (buttons and forms are hidden or locked, and the system refuses changes even if someone tries to force them). Passwords are set in Vercel (`APP_PASSWORD` and `VIEWER_PASSWORD`); to change one, edit it there and redeploy.

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

## Keeping Azure DevOps and Solo Scrum in step
Each line of business can be linked to one Azure DevOps project. Press a button and changes flow both ways. It never runs by itself, so nothing changes until you press it.

**One-time setup (owner)**
1. In Azure DevOps click your profile picture → **Personal access tokens** → **New token**. Name it *Solo Scrum*, choose the organization, set the expiry to 90 days and under **Scopes** pick **Work Items → Read & write**. Copy the token once; it is never shown again.
2. In Vercel open the project → **Settings → Environment Variables** and add `ADO_ORG` (the organization name from the Azure DevOps address, for example `act-eg`) and `ADO_PAT` (the token). Redeploy.
3. Never paste the token in chat, email or the code. When it expires, make a new one and replace `ADO_PAT`. If it is ever shared by mistake, revoke it in Azure DevOps straight away.

**Linking** Open **Azure DevOps** in the menu, choose the project for each line of business and click **Save link**. A line can be linked to one project, and the choice is fixed once items have come in.

**Every sync**
1. Click **Check changes**. It shows what would happen and changes nothing on either side.
2. If it looks right, click **Sync now**. The report lists what was brought in, what was sent, conflicts and anything that needs your attention.
3. Press it again if the report says some changes were postponed; a sync stops after about 35 seconds of sending to stay inside the free hosting limits, and picks up where it stopped.

**Who decides what**
| Azure DevOps decides | This system decides | Either side (the latest change wins) |
|---|---|---|
| Title, description, acceptance criteria, item type, where it sits in the hierarchy | Task hours (sent to Azure DevOps as *Remaining work*; zero once Done), order, blocked flag, priority after the first import | Status, the assignee of a task, the sprint of a story or bug (its open tasks follow) |

**Good to know**
- New items are created here only. Items are never created or deleted in Azure DevOps, and nothing is deleted here either.
- The first time a project is synced, finished items older than 60 days are left out (tick *Also bring in old finished items* to include them). Items from the types we do not use (test cases, impediments…) are ignored.
- Azure DevOps allows more nesting than this system. A bug under a user story is placed under that story's feature, and a feature with no epic, or a task with no story, is not brought in; the report names them.
- People are matched to members by name. If someone is assigned in Azure DevOps but is not a member here, the report names them: add the member and the next sync fills it in.
- Past sprints that do not exist here are not created: their stories wait in the backlog. Sprints that have not ended yet are created (or linked, when a sprint with the same name exists) automatically.
- If a person edits an item in Azure DevOps at the very moment we send our change, nothing is overwritten; it is retried next sync.
- When both sides changed the same field since the last sync, the most recent change wins and the conflict is listed in the report.
- The view-only account can see the page and the last report but cannot run a sync.

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
