# System usage reporting — RSD REQ-23 and challenge statement

**Scope:** Local, fictional-data UVSS Food Bank portfolio prototype.
Do not import real student, contact, or survey data.

## Requirements and definitions

The RSD's REQ-23 requires a term report of students served and
appointments that are booked, completed, missed or cancelled. The
RSD also requires term reports to generate in under 5 seconds, and
its acceptance test compares report counts with actual system records.

The challenge statement additionally asks for service trends over a
semester or year, date-range filters, exportable record-keeping data,
and information about household types and needs.

The dashboard is **staff-only**, with these metrics:

| Metric | Exact meaning |
|---|---|
| Students served | DISTINCT student accounts with >=1 appointment in `completed` status in selected range |
| Booked | Booking rows still in `booked` status, including future bookings and overdue appointments awaiting review |
| Completed | Booking rows in `completed` status; a student may have more than one completed appointment in the range |
| Missed | Booking rows in `no_show` status |
| Cancelled | Booking rows in `cancelled` status, including cancellations caused by staff closing a slot |
| Total | All booking rows of the four statuses combined; not a count of historical booking events |
| Awaiting outcome | Booked rows whose scheduled end has passed; these are still counted in Booked |

**Date basis:** All filters use the appointment's scheduled start
date in **America/Vancouver**, including both the beginning and
ending date. This is not the date when the student originally booked,
cancelled or staff marked the pickup complete. Rescheduled bookings
are attributed to their **current** slot, not counted as two
appointments. Cancelled bookings are attributed to their originally
scheduled slot unless that booking was previously rescheduled.

## Staff dashboard

Log in as fictional staff and find **System usage reporting**.

1. Choose an existing term. The default date range is the term's
   complete start/end dates. Narrow dates to any period within it.
2. Alternatively choose **All terms** and a custom date range to
   generate an annual/cross-term report (up to 366 days inclusive).
3. Click **Generate usage report**.
4. See six summary metrics, a notice for overdue unmarked bookings,
   a week-by-week stacked status trend, and an accessible weekly
   data table inside an expandable section.
5. See counts of **completed pickup designations**: student,
   dependent, or approved third-party contact.
6. See **distinct students served by CURRENT confirmed dependents**:
   zero, one, or two or more. Those counts are a present-day snapshot,
   **not** a record of each student's household as of the pickup date.
7. Download aggregate results as CSV, with week and metric rows.

Week labels are Mondays in Vancouver-local time. The first and last
week may represent a partial week when the date filters cut into it.
Empty weeks are represented as zeros, and an empty term reports zeros
rather than raising an error.

## Reporting limits for the demonstration survey

The prototype's current eligibility survey records only confirmation
and understanding booleans; it does not collect a vetted food-needs
questionnaire. **There is no needs breakdown.** Neither dependent
counts nor pickup designations should be presented as proxies for
needs, food insecurity, disability or household income.

Implementing genuine needs reporting requires UVSS-approved
questions, informed consent, data minimization and a privacy review.
Do not create synthetic needs classifications for real people.

## HTTP API

All three endpoints require an authenticated `staff` role:

| Method | Path | Response |
|---|---|---|
| GET | `/api/staff/reports/terms` | Available reporting terms with date bounds |
| GET | `/api/staff/reports/usage?termId=UUID[&fromDate=YYYY-MM-DD&toDate=YYYY-MM-DD]` | Aggregate JSON |
| GET | `/api/staff/reports/usage.csv?termId=UUID[&fromDate=YYYY-MM-DD&toDate=YYYY-MM-DD]` | UTF-8 CSV attachment |

Use `termId=all` **with both dates** to report across terms.
All dates must be valid and ordered. For a specific term, both dates
must be within that term's limits. If supplied, **both** date fields
are required. The all-terms range is bounded to 366 inclusive days.
Invalid input returns HTTP 400/422; missing terms return HTTP 404.

Each report runs inside a PostgreSQL **read-only repeatable-read
transaction**, so summary/trend/breakdown counts come from one
consistent snapshot even when staff are marking outcomes concurrently.
No student IDs, names, addresses, contact values, or raw survey
responses are returned by either report endpoint. Export escapes
spreadsheet formula prefixes in staff-defined term names.

CSV structure: `section,period,metric,value`. Sections include
`metadata`, `summary`, `weekly`, `completed_pickup_types`,
`served_current_confirmed_dependents`, and `data_availability`.
CSV exports are generated from the database when the download is
requested; if records have changed since the on-screen report was
generated, re-run the report to see the same latest counts.

## Local setup

No new database tables, schema migration or package dependency.
Your database must already have migrations 001–005.

From a clean project working tree:

    git status
    git switch main
    git pull --ff-only origin main
    git fetch origin
    git switch --track origin/feature/system-usage-reporting

Start the backend and frontend with `npm run dev` in separate
terminals; run `npm ci` in a directory only if its dependencies are
missing. Open `http://localhost:5173` in a browser profile logged
into the fictional staff account.

### Manual checks

1. With staff, select a term containing one each of completed,
   missed, cancelled and booked records. Verify each total against
   the staff appointment roster, using the same scheduled-date
   filtering when comparing. If none exist, use the fictional
   automated test fixture rather than waiting weeks.
2. Confirm two completed appointments for the same student count
   as **two completed** but **one student served**.
3. Choose an empty date range and verify zeros and no crash.
4. Choose a subset of dates; check its weekly totals and filters.
5. Choose All terms and an annual period; confirm multiple terms
   are aggregated without revealing individual students.
6. Export CSV and compare summary numbers and weekly rows.
7. In a separate fictional student profile, attempt `/api/staff/reports/terms`,
   `/api/staff/reports/usage`, and `/api/staff/reports/usage.csv`.
   Requests must be forbidden (HTTP 403). Anonymous requests are
   unauthorized (HTTP 401). No staff reporting view is rendered.
8. Confirm the reporting panel remains keyboard usable and
   readable when the browser window is narrow.

### Automated integration tests

Run with the backend already running:

    cd backend
    npm run test:reporting

The test uses four random fictional student accounts, a dedicated
fictional term, known past/future bookings, approved dependents and
a contact. It validates accurate totals, distinct students served,
the weekly rollup, household/pickup breakdown, date boundaries,
annual mode, role privacy, CSV formula safety, and changes reflected
after staff finalize an overdue booking. Fixture-owned records are
deleted afterward. GitHub Actions uses a disposable PostgreSQL DB.

## Performance and production scope

The RSD target is **under five seconds per term report**. The
test logs a fixture-query duration, but it does **not** demonstrate
performance at the RSD scale of 1,100 students or under concurrent
load. Benchmarking those scenarios remains a pre-deployment task.
Queries are SQL aggregates with bounded date ranges, not a browser
loop through every personal appointment. The CSV export contains
aggregate results only.

Real needs reporting, historical household snapshots, an individual
staff records viewer, formal privacy review, live authentication
and production deployment are separate future milestones.
