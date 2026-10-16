## 0. Moving from PostgreSQL / Prisma to MongoDB

The app now runs on MongoDB through Mongoose. Nothing in your PostgreSQL database is touched by the app or by
the migration script, so you can roll back at any point until you delete it yourself.

## 1. Start MongoDB

Transactions need a replica set (Atlas clusters already are one).

```bash
docker compose up -d db          # single-node replica set "rs0" on localhost:27017
```

## 2. Configure

In `backend/.env` remove `DATABASE_URL` and add:

```
MONGODB_URI="mongodb://127.0.0.1:27017/ticket_mgmt?replicaSet=rs0&directConnection=true"
# MONGO_TRANSACTIONS=auto|on|off   (auto = use transactions when the server supports them; on = require them)
```

`MONGODB_URI` is required when `NODE_ENV=production`.

## 3. Create indexes

```bash
cd backend
npm install
npm run db:indexes   # optional: the API also creates indexes at startup
```

## 4. Copy the data (one time)

```bash
DATABASE_URL="postgresql://..." npm run db:migrate-from-postgres -- --dry-run      # counts only, writes nothing
DATABASE_URL="postgresql://..." npm run db:migrate-from-postgres                   # copy + verify
DATABASE_URL="postgresql://..." npm run db:migrate-from-postgres -- --verify-only  # compare again, no writes
```

* Existing ids are kept as the document `_id`, so every link, session cookie and bookmark keeps working.
* PostgreSQL is read in a READ ONLY, REPEATABLE READ transaction. Timestamps are read as UTC.
* It is safe to run again: documents are upserted by `_id`, so a re-run repairs anything missing or changed.
* Verification compares per-collection counts and a fingerprint of every row, checks that no record points at a
  missing parent, and checks there is exactly one Super Admin per organisation. A JSON report
  (`migration-report-*.json`) is written next to where you ran it. The command exits non-zero if anything differs.

## 5. Test the app on MongoDB

```bash
npm run dev
```

## 6. Clean up (only after you are happy)

* Delete the rest of `backend/prisma/` (schema + SQL migrations).
* Remove the `pg` dependency (only the migration script uses it) and `@types/pg` if present.
* Stop and delete the old PostgreSQL service/volume (`pgdata`) or the hosted database.

## Multiple assignees per ticket (upgrade note)

Tickets now carry `assigneeIds` (a list) instead of one `assigneeId`.

* **Data already in MongoDB** (migrated before this release, or created by the previous version): nothing to run. The API
  upgrades old tickets itself every time it starts (`assigneeIds = [assigneeId]` or `[]`, then the old field is removed),
  prints `MongoDB connected successfully ...`, and creates any missing collections/indexes. It never touches a ticket that
  already has `assigneeIds`. (`npm run db:migrate-assignees` still exists if you want a dry run or to do it without starting the API.)
* **Still migrating from PostgreSQL:** nothing extra. `db:migrate-from-postgres` already writes `assigneeIds` for every ticket.
* Only Admins / Super Admins can assign or unassign, and only members of the ticket's project (admins plus developers
  attached to the project) can be added. People already on a ticket stay assigned even if they leave the project.
