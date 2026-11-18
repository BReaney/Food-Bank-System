# UVSS Food Bank — Testing

This top-level folder separates new quality-assurance work from the React,
Express and PostgreSQL application code.

## Start here

1. **[Test results](test-results.md)** — easily readable, **committed**
   evidence of the latest verified CI run, including all 36 new AT test
   cases and the existing regression suites.
2. **[RSD traceability matrix](requirements-matrix.md)** — the RSD's
   original ten test-case groups (`TS-01`–`TS-10`), all 26 functional
   and 12 non-functional requirements, how they are tested, and what
   remains manual or deferred.
3. **[Automated acceptance suite](integration/rsdAcceptance.ts)** —
   36 additional individually labeled HTTP/PostgreSQL test cases.
4. **Generated execution reports** (`results/latest-run.md` and
   `results/latest-run.json`) — produced by each test execution,
   downloadable in GitHub Actions under `rsd-acceptance-results`.
   These temporary output files are not committed to Git so each CI run
   has its own attributable evidence.

## What is actually covered?

The new suite follows a realistic fictional user lifecycle: registering
accounts, validating profiles, submitting a survey, obtaining staff
verification, booking and managing an appointment, approving a pickup
contact and dependent, checking staff records and reports, verifying
student privacy, acknowledging notifications, and logging out.

It checks both positive paths and commonly expected errors. Every AT
case logs `PASS AT-xx` or `FAIL AT-xx`, and records its RSD IDs.
Failures cause the CI job to fail. Cases not reached after a failure
are **not** counted as passed.

The GitHub Actions workflow **also runs existing tests** (without
duplicating their code): authentication, enrollment/eligibility, staff
pagination, booking management, household, calendar, staff outcomes,
usage reporting, unified records, calendar UI guards, and page
navigation. Those legacy suites remain in their original locations
to preserve existing build scripts and the working prototype.

## Run locally — Windows / VS Code

From the repository root, update the feature branch:

    git fetch origin
    git switch main
    git pull --ff-only origin main
    git switch --track origin/feature/rsd-acceptance-tests

If the local feature branch already exists, use
`git switch feature/rsd-acceptance-tests` and
`git pull --ff-only origin feature/rsd-acceptance-tests` instead.

**Never run `npm run test:db-setup` on your normal local database.**
That command resets a disposable CI fixture and has a CI-only guard.

Start your existing **local PostgreSQL** with migrations 001–006 already
applied and fictitious demo accounts provisioned. Confirm the backend's
existing `backend/.env` contains `ENABLE_PROTOTYPE_AUTH=true`,
`PGHOST=localhost`, `PGDATABASE=foodbank_dev` and the existing
`DEMO_STAFF_PASSWORD`. No new schema migration is required.

Terminal 1 (keep running):

    cd backend
    npm run dev

Terminal 2 (from the project root):

    cd backend
    npm run test:acceptance

The suite creates only its own two fictional students, an isolated term,
three appointment slots and related records, and removes its fixtures
afterward. It does not use real personal data. Review:

- `testing/results/latest-run.md` — human-readable execution report.
- `testing/results/latest-run.json` — result metadata and durations.

To rerun the preexisting full suite, inspect
`.github/workflows/build.yml` or allow GitHub Actions to execute it.
Each CI run starts its own **disposable PostgreSQL 17 database** with
fictional accounts, applies all migrations and runs all suites.

## Status conventions

- **PASS** in `test-results.md` means an assertion really ran in a
  referenced CI job and did not fail.
- **Manual** means a browser test is still required (e.g., exact text,
  mobile responsiveness, screen-reader/keyboard usability).
- **Deferred** means the agreed prototype scope excludes the test for
  now (e.g., 10 simultaneous bookings, full 1,100-account load).
- **Unverified** means no admissible evidence is available; neither
  a build passing nor an adjacent test should be interpreted as a pass.

This prototype is for portfolio demonstration with fictional records,
not real student accounts or UVic/UVSS operational use.
