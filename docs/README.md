# Documentation

The [root README](../README.md) is the **current entry point** for project features, local installation, demo accounts, and security limitations. The documents below explain individual implementation choices and preserve the project history.

> **Unofficial project:** This is an independent personal-development portfolio prototype, **not affiliated with or endorsed by the University of Victoria (UVic) or the University of Victoria Students' Society (UVSS)**. Use fictional demonstration records only.

## Start here

| Document | Purpose |
|---|---|
| [Root README](../README.md) | Complete overview and first-time local setup |
| [Architecture and data flows](architecture.md) | Components, data model, API boundaries and main workflows |
| [Database setup and migrations](../database/README.md) | Create a new database, apply migrations 001–006, seed fictional data |
| [Testing guide](../testing/README.md) | RSD testing process and local/CI execution |
| [RSD traceability matrix](../testing/requirements-matrix.md) | All functional and nonfunctional requirements mapped to tests |
| [Latest verified test results](../testing/test-results.md) | Source-attributed automated results and honest deferrals |

## Implementation and design notes

These are **historical milestone notes**, useful for understanding *why* the current system was built a certain way. Some describe old feature branches or setup stages and should **not** be followed instead of the current root README when installing a new copy.

### Student features and account safety

- [Authentication and profiles](authentication-and-profiles.md)
- [Eligibility and enrollment](eligibility-and-enrollment.md)
- [Appointment management](appointment-management.md)
- [Dependents and third-party pickups](dependents-third-party-pickups.md)
- [In-app notifications](in-app-notifications.md)

### Staff features

- [Staff calendar management](staff-calendar-management.md)
- [Staff appointment outcomes](staff-appointment-outcomes.md)
- [Unified staff records](unified-staff-records.md)
- [System usage reporting](system-usage-reporting.md)
- [Staff pagination](staff-pagination.md)

### UI and reliability

- [Page-based navigation](page-based-navigation.md)
- [Calendar UI state cleanup](calendar-ui-state-cleanup.md)

## Repository structure

- `backend/src/` — application API, server-side authorization and business logic.
- `frontend/src/` — React UI components, navigation and calendar.
- `database/migrations/` — ordered PostgreSQL migrations, **run once** for a new local DB.
- `database/seed/` — fictional sample term, profiles and slot.
- `testing/` — RSD traceability, independent acceptance tests and evidence.
- `.github/workflows/` — full-stack CI using a disposable fictional PostgreSQL database.

No historical milestone document constitutes approval for use with real student records.
