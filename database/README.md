# PostgreSQL setup and schema

This directory contains the **current** database setup for the [Food Bank Booking System](../README.md).

> **Independent, unaffiliated portfolio project.** Not affiliated with UVic or UVSS. Use **fictional local data only**. Do not connect to a real university/student database.

## Prerequisites

- A locally running PostgreSQL instance (the CI workflow uses **PostgreSQL 17**).
- `pgAdmin 4` or the `psql` command-line client.
- The application database must be named **`foodbank_dev`** and owned by a dedicated local development role **`foodbank_app`**, matching the sample `backend/.env.example`.

## Create a new, empty database

Connect to local PostgreSQL as an administrator (usually `postgres`) through pgAdmin. In a Query Tool connected to the `postgres` maintenance database, execute these statements **separately**:

```sql
CREATE ROLE foodbank_app WITH LOGIN PASSWORD 'REPLACE_WITH_A_STRONG_LOCAL_PASSWORD';
```

```sql
CREATE DATABASE foodbank_dev OWNER foodbank_app;
```

Use a unique local password. **`CREATE DATABASE` cannot execute inside a transaction block**, so do not select and run both commands as a single transaction.

Register a connection in pgAdmin using host `localhost`, port `5432`, maintenance database `foodbank_dev`, username `foodbank_app`, and your chosen password.

If the role/database already exists, **do not run the create commands again**.

## Fresh installation — ordered migrations

The repository has **six migrations**. Run each **exactly once, in sequence**, on a **new** `foodbank_dev` DB, connected as `foodbank_app`:

| Step | Migration | Purpose |
|---|---|---|
| 1 | [001_core.sql](migrations/001_core.sql) | Profiles, terms, enrollment, surveys, slots, bookings, events, audit logs, slot availability |
| 2 | [002_auth.sql](migrations/002_auth.sql) | Credentials and persistent session tables |
| 3 | [003_enrollment_history.sql](migrations/003_enrollment_history.sql) | Enrollment decision events |
| 4 | [004_household_pickups.sql](migrations/004_household_pickups.sql) | Dependents, pickup contacts, consent history and booking references |
| 5 | [005_staff_calendar.sql](migrations/005_staff_calendar.sql) | Staff schedule event support and private slot-change notifications |
| 6 | [006_booking_notifications.sql](migrations/006_booking_notifications.sql) | Booking confirmation/cancellation/rescheduling notifications and inbox index |

On Windows PowerShell, run from the repository root if `psql` is in PATH:

```powershell
psql -h localhost -U foodbank_app -d foodbank_dev -v ON_ERROR_STOP=1 -f database/migrations/001_core.sql
psql -h localhost -U foodbank_app -d foodbank_dev -v ON_ERROR_STOP=1 -f database/migrations/002_auth.sql
psql -h localhost -U foodbank_app -d foodbank_dev -v ON_ERROR_STOP=1 -f database/migrations/003_enrollment_history.sql
psql -h localhost -U foodbank_app -d foodbank_dev -v ON_ERROR_STOP=1 -f database/migrations/004_household_pickups.sql
psql -h localhost -U foodbank_app -d foodbank_dev -v ON_ERROR_STOP=1 -f database/migrations/005_staff_calendar.sql
psql -h localhost -U foodbank_app -d foodbank_dev -v ON_ERROR_STOP=1 -f database/migrations/006_booking_notifications.sql
```

Alternatively, open each file with pgAdmin Query Tool under `foodbank_app`, execute in order, and check that it succeeds before moving to the next.

**Do not rerun completed migrations.** There is currently no automated migration version tracker or migration runner. On an **existing local database**, apply **only any missing migrations**, in sequence, after checking the schema and making a local backup.

## Load fictional demonstration data

After completing all migrations:

```powershell
psql -h localhost -U foodbank_app -d foodbank_dev -v ON_ERROR_STOP=1 -f database/seed/demo.sql
```

Or run [demo.sql](seed/demo.sql) in pgAdmin. It creates a `DEMO` term, fictional profiles and one future demo slot.

Next:

1. Create `backend/.env` from `backend/.env.example`, using the local DB password.
2. Set **different** fictional passwords in `DEMO_STAFF_PASSWORD` and `DEMO_STUDENT_PASSWORD`.
3. From `backend/`, run `npm run seed:demo-accounts` to provision staff and student login credentials.

Provisioned demonstration accounts:

- `staff.demo@example.com` (staff)
- `alex.demo@example.com` (student)

**Rerunning `seed:demo-accounts` resets the demo login passwords.** It does not erase student records.

For the full installation from clone through running React and Express, see the [main README](../README.md#run-locally).

## Sanity-check your schema

These read-only queries can be run in pgAdmin while connected as `foodbank_app`:

```sql
SELECT current_database() AS database_name, current_user AS app_role;

SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;

SELECT starts_at, capacity, booked_count, remaining_capacity
FROM slot_availability
ORDER BY starts_at;

SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname = 'student_notifications_category_check';
```

The notification category constraint should include `booking_confirmed`,
`booking_cancelled`, and `booking_rescheduled` after migration 006.

The API also provides a local-only `http://localhost:3001/api/db-health` endpoint for quick connection status.

## Data integrity and privacy notes

- PostgreSQL enforces keys, foreign keys and several invariants. The booking service uses **slot locking and transactions** to enforce capacity, timing and eligibility rules; the database's unique index enforces one noncancelled booking per student per Vancouver-local week.
- Stored timestamps represent instants; the application presents local booking times in **`America/Vancouver`**.
- Survey submission and enrollment verification are **separate per-term records**. Neither fictional survey submission nor demo staff approval is a verified real-world identity.
- Sensitive contact and consent text is held in owner-scoped tables; audit events avoid duplicating those values.
- The prototype lacks production-grade identity assurance, database hardening, backup/recovery automation, privacy-policy approval and operational monitoring. Do not use real user data.

## CI test database (different from your local DB)

The GitHub Actions workflow starts a **disposable PostgreSQL service** with fictional credentials, then executes `backend/src/scripts/setupCiDatabase.ts`. That script applies migrations and resets a **CI-only fixture**, guarded by `CI=true` and expected local parameters.

**Never run `npm run test:db-setup` on your persistent local development database.**

See [RSD acceptance testing](../testing/README.md) for safe commands and evidence.
