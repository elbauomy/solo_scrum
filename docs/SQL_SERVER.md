# Running Solo Scrum on ACT servers (Microsoft SQL Server)

Handover notes for the DevOps engineer. The database layer now targets **Microsoft SQL Server** (tested on SQL Server 2022,
16.0.4305). The schema is in `prisma/schema.prisma` and the full table definition is one migration:
`prisma/migrations/20261108120000_init_sql_server/migration.sql`.

## What the server needs

| Item | Requirement |
|---|---|
| Node.js | 20.9 or newer (tested on 22) |
| Database | SQL Server 2017 or newer, or Azure SQL. An empty database, for example `solo_scrum` |
| Collation | Case-insensitive (the default `SQL_Latin1_General_CP1_CI_AS` is fine). The search boxes rely on it |
| Database login | Needs to create tables the first time (`prisma migrate deploy`), then read and write. Simplest: `db_owner` on this database only |
| HTTPS | Required. In production the sign-in cookie is `Secure`, so over plain HTTP nobody stays signed in. Put the app behind the company reverse proxy or web server with a certificate |
| Outbound internet | Not needed at run time |

## Settings (environment variables)

| Name | Value |
|---|---|
| `DATABASE_URL` | `sqlserver://HOST:1433;database=solo_scrum;user=USER;password=PASSWORD;encrypt=true;trustServerCertificate=false` (named instance: `sqlserver://HOST\INSTANCE;...`; self-signed certificate: `trustServerCertificate=true`; a password containing `;` `=` `{` `}` goes in `{braces}`) |
| `APP_PASSWORD` | Owner password (user name `khaled elbauomy`) |
| `VIEWER_PASSWORD` | View-only password (user name `remoon milad`); empty = that account cannot sign in |
| `SESSION_SECRET` | Random text, at least 32 characters |
| `ADMIN_USERNAME`, `VIEWER_USERNAME` | Optional, to change the user names |
| `NODE_ENV` | `production` |
| `PORT` | Optional, default 3000 |

## Build and run

```bash
npm ci                      # also generates the database client
npx prisma migrate deploy   # creates or updates the tables; safe to run on every release
npm run build
npm start                   # serves on PORT (default 3000)
```

Run `npx prisma migrate deploy` before starting each new version. It only applies migrations that have not run yet.
The database client is generated for the machine that runs `npm ci`. If you build on one OS and run on another,
add the target to `binaryTargets` in `prisma/schema.prisma` (it lists `native` and `rhel-openssl-3.0.x`).

## What differs from the PostgreSQL version

| Topic | How it is stored now |
|---|---|
| Fixed values (item type, status, priority, sprint state) | Text columns (`NVARCHAR(10/20)`). Allowed values are listed in `src/lib/enums.ts` |
| Working days (Settings) | Text such as `0,1,2,3,4` (0 = Sunday), read and written in `src/lib/settings.ts` |
| A closed sprint's saved results (`Sprint.result`) | JSON as text, `NVARCHAR(MAX)` |
| Reserved words | Columns renamed in the database only: `LineOfBusiness.code` (was `key`), `SprintMemberShare.sharePercent` (was `percent`), `StandupEntry.isOff` (was `off`) |
| IDs | `NVARCHAR(36)` |
| Deletes | No `RESTRICT` in SQL Server, so `NO ACTION` is used (same effect: a row still in use cannot be deleted). Deleting a sprint clears `WorkItem.sprintId` in the app, because SQL Server forbids a second automatic delete path to sprint commitments |
| Searches | Case-insensitive through the database collation |

## Moving the current data from Neon (PostgreSQL)

Choose one:

1. **Start empty** and re-import the current sprint planning sheets from *Sprints → Import planning sheet*. Simplest.
2. **Copy the data.** Create the tables first with `npx prisma migrate deploy`, then copy each table from PostgreSQL
   (for example with the SQL Server Import and Export Wizard and a PostgreSQL ODBC source). Do not copy
   `_prisma_migrations`. Convert on the way: `Setting.workingDays` from `{0,1,2,3,4}` to `0,1,2,3,4`; booleans to `1/0`;
   `Sprint.result` and the `ado*` JSON columns to text; the three renamed columns above. Load parents before children,
   or disable constraints during the load and re-enable them `WITH CHECK` afterwards.

## Things to know

- **Vercel and Neon stop updating once this is merged to `main`.** Their build runs `prisma migrate deploy` against the
  Neon PostgreSQL database, which now fails, so Vercel keeps serving its last good version. Switch Vercel off once the
  ACT server is live.
- **The `azure-devops-sync` branch** was written for PostgreSQL. Before it is merged it needs the same treatment: its two
  JSON columns are text now (the sync code must write `JSON.stringify` and read `JSON.parse`), and the uniqueness of
  `(lobId, adoId)` needs a filtered unique index (`WHERE adoId IS NOT NULL`), because SQL Server allows only one empty
  value in a normal unique index.
- **Backups:** *Import & Backup* still downloads every table as one Excel file; database backups are now IT's usual
  SQL Server backups.
