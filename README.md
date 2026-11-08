# Solo Scrum

A personal web tool for a Scrum Master to manage squads, lines of business, members, sprints,
releases, the timeline and Scrum reports, following ACT's own process.

- Product scope: [docs/PRODUCT_PLAN.md](docs/PRODUCT_PLAN.md)
- Technical plan: [docs/TECHNICAL_PLAN.md](docs/TECHNICAL_PLAN.md)

## Two versions

| Branch | Database | Runs on | Who deploys it |
|---|---|---|---|
| `main` | PostgreSQL | Vercel + Neon (the current live site) | Vercel, automatically on every merge |
| `act-sqlserver` | Microsoft SQL Server | ACT servers ([docs/SQL_SERVER.md](docs/SQL_SERVER.md)) | The DevOps engineer, from this branch |
| `azure-devops-sync` | PostgreSQL | Not deployed; waits for the IT approvals | Nobody yet |

Every change goes into **both** `main` and `act-sqlserver`: one pull request into each, from the same working branch.
Most changes apply to both unchanged; a database change needs a PostgreSQL migration on `main` and an SQL Server
migration on `act-sqlserver`. Vercel builds only `main` (`git.deploymentEnabled` in `vercel.json`).
When the ACT server is live, `act-sqlserver` is merged into `main` and Vercel is switched off.

## Status

All phases are built. See [docs/USER_GUIDE.md](docs/USER_GUIDE.md) for how to use the app.

| Phase | Status |
|---|---|
| 1. Foundation: login, settings, holidays, squads, LOBs, members, squad hours, leave | ✅ |
| 2. Work items: hierarchy, IDs, statuses, hours, assignment, priority/rank, blocked, history, backlog filters | ✅ |
| 3. Sprints & releases: planning, shared capacity, board, commitment snapshot, carry-over, release log and forecast | ✅ |
| 4. Timeline: scheduling from availability, slip/overload warnings, baselines | ✅ |
| 5. Daily standup with history | ✅ |
| 6. Reports, health dashboard, Excel and PDF export, full backup | ✅ |
| 7. Excel import (the app's template) | ✅ |
| 8. Sprint planning sheet import (sprint, capacity, user stories, tasks) and manual daily standup status | ✅ |

## Deploying on ACT servers (Microsoft SQL Server)

The app runs on Node.js with a Microsoft SQL Server database. Requirements, settings, build steps, what changed from
the PostgreSQL version and how to move existing data are in [docs/SQL_SERVER.md](docs/SQL_SERVER.md).

```bash
npm ci
npx prisma migrate deploy
npm run build
npm start
```

## Running locally (developers)

```bash
cp .env.example .env      # fill in the values
npm install
npx prisma migrate dev    # create / update tables
npm run dev               # http://localhost:3000
npm test                  # unit tests
```
