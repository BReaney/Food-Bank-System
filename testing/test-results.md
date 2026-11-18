# Test results — UVSS Food Bank Booking System

## Latest verified automated test run

| Field | Recorded result |
|---|---|
| **Overall** | **PASS** — 36/36 newly added acceptance cases and all existing regression suites |
| **Date (UTC)** | 2026-11-18 |
| **Source commit tested** | `69fac2ad3ee3e4302130fc2530f2b299eca1c808` |
| **CI job** | [GitHub Actions run #44398590108](https://github.com/BReaney/Food-Bank-System/actions/runs/44398590108) |
| **Environment** | GitHub Actions, Node.js 24, disposable PostgreSQL 17, fictional accounts |
| **Production data touched** | **None** — CI uses its own PostgreSQL service |
| **New executable suite** | `testing/integration/rsdAcceptance.ts` |
| **Traceability source** | [Requirements matrix](requirements-matrix.md) |
| **Detailed execution artifact** | `rsd-acceptance-results` on the linked CI run; contains `latest-run.md` and `latest-run.json` |

**Interpretation:** PASS indicates the **automated assertions executed successfully**.
It does **not** mean formal end-user acceptance, performance load targets,
UVic data-policy certification, or manual browser accessibility checks passed.

### Existing regression suites reused (not counted as new tests)

| Suite | Command in `backend/` unless noted | CI result |
|---|---|---|
| Auth integration | `npm run test:auth` | **PASS** |
| Eligibility and enrollment | `npm run test:eligibility` | **PASS** |
| Staff roster pagination | `npm run test:pagination` | **PASS** |
| Booking management and notifications | `npm run test:booking-management` | **PASS** |
| Dependents and third-party pickups | `npm run test:household` | **PASS** |
| Staff calendar | `npm run test:calendar` | **PASS** |
| Staff appointment outcomes | `npm run test:staff-outcomes` | **PASS** |
| System usage reporting | `npm run test:reporting` | **PASS** |
| Unified staff records | `npm run test:staff-records` | **PASS** |
| Calendar UI state guards | `npm run test:calendar-state` in `frontend/` | **PASS** |
| Role-specific page navigation | `npm run test:navigation` in `frontend/` | **PASS** |
| New RSD acceptance suite (36 cases) | `npm run test:acceptance` | **PASS — 36/36** |

### New acceptance scenarios — individual results

All 36 case IDs below were observed as **PASS** in the CI job log. They are
separate executable checks with their own assertions, labels, and RSD mappings.

| Test ID | Functional or non-functional RSD refs | Tested behavior | Result |
|---|---|---|---|
| AT-01 | F-02, N-S05 | Anonymous personal profile access is denied | **PASS** |
| AT-02 | F-01, F-04 | Registration rejects real-world email domains in demo | **PASS** |
| AT-03 | F-04 | Registration rejects missing required names | **PASS** |
| AT-04 | F-01, F-05 | Two fictional student accounts can register without staff role | **PASS** |
| AT-05 | F-03 | Duplicate registration is rejected case-insensitively | **PASS** |
| AT-06 | N-S05 | Incorrect password never starts an authenticated session | **PASS** |
| AT-07 | F-01, F-02 | Signed-in students can retrieve only their session identity | **PASS** |
| AT-08 | F-04 | Profile updates require valid nonempty names | **PASS** |
| AT-09 | F-02, N-S06 | Profile name edit cannot escalate role or change email | **PASS** |
| AT-10 | F-05, F-24, N-S06 | Student role cannot search private staff records | **PASS** |
| AT-11 | F-08, F-14 | New student cannot book without survey and enrollment | **PASS** |
| AT-12 | F-09 | Required eligibility survey confirmations cannot be omitted | **PASS** |
| AT-13 | F-06, F-07 | Student can record term-specific survey submission | **PASS** |
| AT-14 | F-07, F-09 | Repeat survey submission for the same term is rejected | **PASS** |
| AT-15 | F-08 | Survey alone does not authorize a booking | **PASS** |
| AT-16 | F-05, F-08 | Only staff can change independent enrollment verification | **PASS** |
| AT-17 | F-07, F-08, F-25 | Staff roster distinguishes survey and enrollment states | **PASS** |
| AT-18 | F-14, F-15, F-16, F-18 | Fully eligible student can book an available slot | **PASS** |
| AT-19 | F-16, N-Q11 | Another eligible student cannot exceed a full slot capacity | **PASS** |
| AT-20 | F-14, F-22 | One active appointment per student per Vancouver week | **PASS** |
| AT-21 | F-18, F-25 | Student booking history and creation event are persisted | **PASS** |
| AT-22 | F-18, F-19, N-S06 | Private booking and notifications cannot leak to another student | **PASS** |
| AT-23 | F-11, F-12 | Third-party contact cannot be created without explicit consent | **PASS** |
| AT-24 | F-10, F-11, F-13 | Valid contact is pending and exact consent disclosure is persisted | **PASS** |
| AT-25 | F-05, F-10, F-13, N-S07 | Only staff can approve a contact; another student cannot edit it | **PASS** |
| AT-26 | F-18, F-19 | Cancellation releases capacity and preserves booking history | **PASS** |
| AT-27 | F-18, F-19 | Cancellation notices persist; repeated cancellation cannot double-write | **PASS** |
| AT-28 | F-10, F-13 | Dependent approval changes pending registration to confirmed | **PASS** |
| AT-29 | F-15, F-17 | Student can book a newly freed slot using approved third-party pickup | **PASS** |
| AT-30 | F-18, F-19 | Reschedule preserves booking ID, event, and private notice | **PASS** |
| AT-31 | F-24, F-25 | Staff student record contains term, household and appointment histories | **PASS** |
| AT-32 | F-24, F-26 | Unmatched staff student search returns an empty result page | **PASS** |
| AT-33 | F-23 | Usage report counts active and cancelled bookings consistently | **PASS** |
| AT-34 | N-S08, F-05 | Staff writes audit events without private survey/contact details | **PASS** |
| AT-35 | F-19, N-S06 | Unread notifications and read-all are scoped and idempotent | **PASS** |
| AT-36 | N-S05 | Logout revokes the session even if the old cookie is reused | **PASS** |

### RSD test-case group assessment (TS-01–TS-10)

| RSD test group | Automated coverage | Actual acceptance status |
|---|---|---|
| TS-01 Account and profile management | PASS — existing auth + AT-01–AT-10 | Partial overall: actual UVic-email requirement uses a fictional-domain prototype alternative |
| TS-02 Eligibility confirmation | PASS — existing eligibility + AT-11–AT-17 | Partial overall: browser redirection/term rollover need review |
| TS-03 Dependents and pickup contacts | PASS — existing household + AT-23–AT-25, AT-28–AT-29 | Automated checks passed; UI and final consent policy review pending |
| TS-04 Student appointment booking | PASS — existing booking + AT-18–AT-22, AT-26–AT-27, AT-29–AT-30, AT-35 | Automated API checks passed; weekly UI review pending |
| TS-05 Staff calendar management | PASS — existing calendar/outcome tests | Automated checks passed; staff browser workflow pending |
| TS-06 Service usage reporting | PASS — existing reporting + AT-33 | Count logic verified; scale/performance not verified |
| TS-07 Staff records menu | PASS — existing records + AT-10, AT-31–AT-32 | Staff records API verified; exact on-screen empty-state text manual |
| TS-08 Performance | Not run at RSD targets | **Deferred/unverified**: 1,100 users, 10 concurrent bookings, 3s and 5s thresholds |
| TS-09 Security | PASS — automated permission/ownership/audit suites | Local prototype authorization checked; formal UVic/UVSS policy review unverified |
| TS-10 Quality/operation | PASS — calendar rules and navigation tests | Mobile/keyboard and operating-hours checks require manual review |

### Known boundaries and follow-up

- All new cases assert actual authenticated HTTP responses and where appropriate
  PostgreSQL rows or event/audit history. No real student accounts are used.
- New test cases use a **fictional test-only term**, two **fictional test accounts**,
  and three nonoverlapping future appointment slots. Test-created data is removed
  after the run, including created notifications, bookings, enrollment and
  household records. Staff **search audit entries without personal data** are
  retained, consistent with existing audit behavior.
- **No 1,100-user benchmark** or 10-way booking concurrency test was performed.
  The previously agreed concurrency deferral remains in place.
- No mobile browser automation or accessibility certification was performed.
- The suite does not modify booking, eligibility, or reporting implementation;
  this is a **test-only milestone**.
- On subsequent CI runs, download the latest `rsd-acceptance-results`
  artifact to compare with this committed snapshot. This file records a
  verified run at the SHA above and is **not automatically rewritten by CI**.

