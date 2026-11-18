# RSD requirement-to-test traceability matrix

**Project:** UVSS Food Bank Booking System — local fictional-data prototype  
**Source:** `UVSS Booking System RSD (1).pdf`, Sections 2.1–2.2 and 3.2.1–3.2.10.  
**Maintained in:** `testing/` (no production-code test files added).  

## Notation

- **F-01 to F-26:** 26 RSD *functional* REQ IDs (RSD Section 2.1).
- **N-P01 to N-P04:** 4 RSD *performance* IDs; **N-S05 to N-S09:** 5 *security* IDs; **N-Q10 to N-Q12:** 3 *quality* IDs. Prefixes disambiguate the RSD's reused numbers.
- **TS-01 to TS-10:** the RSD's original ten grouped test-case sets (Section 3.2).
- **AT-01 to AT-36:** **36 additional automated API/database cases** in `testing/integration/rsdAcceptance.ts`.
- `test:...` names refer to existing regression suites; those tests are **reused**, not falsely counted as new.
- A green GitHub Actions run is **not** a certification of requirements that still need browser tests, production identity integration, policy approval, or load benchmarking.

## RSD original test-case groups

| RSD group | RSD scenario | Requirement IDs | Automated evidence | Additional verification |
|---|---|---|---|---|
| TS-01 | Profile registration and management | F-01–F-05 | test:auth; AT-01–AT-10 | UI registration/input messages still need manual inspection |
| TS-02 | Eligibility confirmation | F-06–F-09 | test:eligibility; AT-11–AT-17 | Auto-redirection and semester turnover need UI/manual review |
| TS-03 | Dependent and third-party pickups | F-10–F-13 | test:household; AT-23–AT-25, AT-28–AT-29 | Consent and household form usability manual |
| TS-04 | Student appointment booking | F-14–F-19 | test:booking-management; AT-18–AT-22, AT-26–AT-27, AT-29–AT-30, AT-35 | Weekly calendar display needs browser review |
| TS-05 | Staff appointment management | F-20–F-22 | test:calendar; test:staff-outcomes; test:calendar-state | Existing integration assertions; staff workflow manual |
| TS-06 | System usage reporting | F-23 | test:reporting; AT-33 | True-scale performance unverified |
| TS-07 | Staff records menu | F-24–F-26 | test:staff-records; test:pagination; AT-10, AT-31–AT-32 | Exact 'No Records Found' UI copy check manual |
| TS-08 | Performance | N-P01–N-P04 | test:pagination; test:reporting (partial) | RSD targets NOT verified; simultaneous load deliberately deferred |
| TS-09 | Security | N-S05–N-S09 | test:auth; test:household; test:staff-records; AT-01, AT-09–AT-10, AT-22, AT-25, AT-34–AT-36 | Policy certification not performed |
| TS-10 | Software quality | N-Q10–N-Q12 | test:eligibility; test:calendar; test:navigation (partial) | Operating-hours uptime and device testing not automated |

## Functional requirements

| Requirement | Expected behavior (abridged) | Test coverage | Scope/acceptance note |
|---|---|---|---|
| **F-01** | UVic email registration | AT-02, AT-04, test:auth | **Prototype variant** — fictional @example domains only, no real enrollment/email ownership |
| **F-02** | Profile view/edit | AT-01, AT-07–09, test:auth | Automated; browser edit check remains manual |
| **F-03** | Duplicate account rejection | AT-05, test:auth | Automated |
| **F-04** | Invalid/incomplete profile validation | AT-02–03, AT-08, test:auth | Automated API rejection; per-field UI feedback manual |
| **F-05** | Staff-only role for management | AT-04, AT-10, AT-16, AT-25, test:auth | Automated role checks |
| **F-06** | Eligibility survey presented when missing/expired | AT-13, test:eligibility | API/term-status automatic; UI presentation manual |
| **F-07** | Survey stores responses, term and completion | AT-13–14, AT-17, test:eligibility | Automated |
| **F-08** | Booking blocked until survey and verification; survey redirection | AT-11, AT-15–17, test:eligibility | Booking gate automated; **survey redirection** still needs browser review |
| **F-09** | Required survey questions validated | AT-12, AT-14, test:eligibility | Automated API; browser feedback manual |
| **F-10** | Dependents and third-party contacts created/updated/removed | AT-24–25, AT-28, test:household | Automated across suites |
| **F-11** | Explicit pickup consent displayed/saved/viewed by staff | AT-23–24, test:household | Automated; consent wording intentionally demonstration-only |
| **F-12** | Required dependent/contact fields validated | AT-23, test:household | Automated |
| **F-13** | Pending/confirmed/denied household statuses | AT-24–25, AT-28, test:household | Automated; UI review manual |
| **F-14** | Student calendar distinguishes available/full/own slots | AT-18–20, test:calendar, test:calendar-state | API states automated; visual calendar manual |
| **F-15** | 7-day minimum and staff booking window | AT-18, AT-29, test:booking-management, test:calendar | Automated window rules |
| **F-16** | Full slots cannot be booked | AT-19, test:booking-management | Automated |
| **F-17** | Select approved dependent or third-party pickup | AT-29, test:household | Automated |
| **F-18** | Upcoming bookings plus cancel/reschedule | AT-18, AT-20–22, AT-26–27, AT-30, test:booking-management | Automated backend; UI review manual |
| **F-19** | Student booking/cancellation/reschedule confirmations | AT-22, AT-26–27, AT-30, AT-35, test:booking-management | In-app notifications verified; **no email/SMS** |
| **F-20** | Staff term calendar and slot creation | test:calendar | Automated API; browser staff calendar manual |
| **F-21** | Staff edit/closure notifies affected bookings | test:calendar, test:calendar-state | Automated |
| **F-22** | Invalid/overlapping bookings rejected | AT-20, test:calendar, test:booking-management | Automated |
| **F-23** | Report served/booked/completed/missed/cancelled | AT-33, test:reporting, test:staff-outcomes | Automated counts and CSV validation |
| **F-24** | Staff-only searchable records menu | AT-10, AT-31–32, test:staff-records | Automated backend; UI navigation manual |
| **F-25** | Enrollment, appointments, household histories | AT-17, AT-21, AT-31, test:staff-records | Automated |
| **F-26** | Exact 'No Records Found' message | AT-32, test:staff-records | API zero-results automated; **exact on-screen copy needs manual check** |

## Non-functional requirements

| Requirement | Expected behavior (abridged) | Evidence | Status/limitation |
|---|---|---|---|
| **N-P01** | At least 1,100 registered accounts | test:pagination (225 students) | **Not verified** at RSD target scale |
| **N-P02** | Booking/view/cancel requests under 3 seconds | test:booking-management | **Not benchmarked** at representative load |
| **N-P03** | At least 10 simultaneous bookings without double-booking | — | **Deferred by project agreement**; no concurrency test claimed |
| **N-P04** | Term report generated under 5 seconds | test:reporting | Fixture timing only; **not benchmarked** at target scale |
| **N-S05** | Login required for personal and staff data | AT-01, AT-06–07, AT-36, test:auth | Automated |
| **N-S06** | Student-owned data and staff-only records | AT-09–10, AT-22, AT-35, test:auth, test:staff-records | Automated |
| **N-S07** | Household contact privacy | AT-25, test:household | Automated |
| **N-S08** | Staff student-record actions audited | AT-34, test:staff-records, test:household | Automated |
| **N-S09** | UVic/UVSS data-policy compliance | — | **Not verified**; requires formal stakeholder/legal approval |
| **N-Q10** | Availability during food bank operating hours | — | **Not verified**; local prototype is not an operated service |
| **N-Q11** | Booking limits and per-term eligibility reset | AT-11, AT-19–20, test:eligibility, test:booking-management | Per-term checks automated; formal rollover review/manual evidence pending |
| **N-Q12** | Desktop and mobile usability | test:navigation, test:calendar-state | Responsive code exists; browser/device/accessibility checks manual |

## New executable acceptance scenarios (36)

Each AT ID below is a concrete, independent `check()` with assertions,
not a manually imagined test. The suite uses one carefully controlled
fictional-student lifecycle, and stops on a failing assertion while writing
its results file. A failure prevents downstream cases from being reported
as passed.

| ID | Targeted RSD IDs | Assertion scenario | Implementation |
|---|---|---|---|
| AT-01 | F-02, N-S05 | Anonymous personal profile access is denied | `rsdAcceptance.ts` |
| AT-02 | F-01, F-04 | Registration rejects real-world email domains in demo | `rsdAcceptance.ts` |
| AT-03 | F-04 | Registration rejects missing required names | `rsdAcceptance.ts` |
| AT-04 | F-01, F-05 | Two fictional student accounts can register without staff role | `rsdAcceptance.ts` |
| AT-05 | F-03 | Duplicate registration is rejected case-insensitively | `rsdAcceptance.ts` |
| AT-06 | N-S05 | Incorrect password never starts an authenticated session | `rsdAcceptance.ts` |
| AT-07 | F-01, F-02 | Signed-in students can retrieve only their session identity | `rsdAcceptance.ts` |
| AT-08 | F-04 | Profile updates require valid nonempty names | `rsdAcceptance.ts` |
| AT-09 | F-02, N-S06 | Profile name edit cannot escalate role or change email | `rsdAcceptance.ts` |
| AT-10 | F-05, F-24, N-S06 | Student role cannot search private staff records | `rsdAcceptance.ts` |
| AT-11 | F-08, F-14 | New student cannot book without survey and enrollment | `rsdAcceptance.ts` |
| AT-12 | F-09 | Required eligibility survey confirmations cannot be omitted | `rsdAcceptance.ts` |
| AT-13 | F-06, F-07 | Student can record term-specific survey submission | `rsdAcceptance.ts` |
| AT-14 | F-07, F-09 | Repeat survey submission for the same term is rejected | `rsdAcceptance.ts` |
| AT-15 | F-08 | Survey alone does not authorize a booking | `rsdAcceptance.ts` |
| AT-16 | F-05, F-08 | Only staff can change independent enrollment verification | `rsdAcceptance.ts` |
| AT-17 | F-07, F-08, F-25 | Staff roster distinguishes survey and enrollment states | `rsdAcceptance.ts` |
| AT-18 | F-14, F-15, F-16, F-18 | Fully eligible student can book an available slot | `rsdAcceptance.ts` |
| AT-19 | F-16, N-Q11 | Another eligible student cannot exceed a full slot capacity | `rsdAcceptance.ts` |
| AT-20 | F-14, F-22 | One active appointment per student per Vancouver week | `rsdAcceptance.ts` |
| AT-21 | F-18, F-25 | Student booking history and creation event are persisted | `rsdAcceptance.ts` |
| AT-22 | F-18, F-19, N-S06 | Private booking and notifications cannot leak to another student | `rsdAcceptance.ts` |
| AT-23 | F-11, F-12 | Third-party contact cannot be created without explicit consent | `rsdAcceptance.ts` |
| AT-24 | F-10, F-11, F-13 | Valid contact is pending and exact consent disclosure is persisted | `rsdAcceptance.ts` |
| AT-25 | F-05, F-10, F-13, N-S07 | Only staff can approve a contact; another student cannot edit it | `rsdAcceptance.ts` |
| AT-26 | F-18, F-19 | Cancellation releases capacity and preserves booking history | `rsdAcceptance.ts` |
| AT-27 | F-18, F-19 | Cancellation notices persist; repeated cancellation cannot double-write | `rsdAcceptance.ts` |
| AT-28 | F-10, F-13 | Dependent approval changes pending registration to confirmed | `rsdAcceptance.ts` |
| AT-29 | F-15, F-17 | Student can book a newly freed slot using approved third-party pickup | `rsdAcceptance.ts` |
| AT-30 | F-18, F-19 | Reschedule preserves booking ID, event, and private notice | `rsdAcceptance.ts` |
| AT-31 | F-24, F-25 | Staff student record contains term, household and appointment histories | `rsdAcceptance.ts` |
| AT-32 | F-24, F-26 | Unmatched staff student search returns an empty result page | `rsdAcceptance.ts` |
| AT-33 | F-23 | Usage report counts active and cancelled bookings consistently | `rsdAcceptance.ts` |
| AT-34 | N-S08, F-05 | Staff writes audit events without private survey/contact details | `rsdAcceptance.ts` |
| AT-35 | F-19, N-S06 | Unread notifications and read-all are scoped and idempotent | `rsdAcceptance.ts` |
| AT-36 | N-S05 | Logout revokes the session even if the old cookie is reused | `rsdAcceptance.ts` |

## Manual and intentionally deferred items

The original RSD also calls for browser-visible feedback and larger-scale
performance. These are **not marked passed by this API-level suite**:
actual UVic identity/email ownership (F-01); automatic survey redirection
(F-08); exact empty-result UI copy (F-26); real email/SMS delivery (F-19
is implemented as local in-app notices only); active service uptime
(N-Q10); desktop/mobile/screen-reader verification (N-Q12);
1,100-account scale, under-3-second request latency, and under-5-second
report latency (N-P01, N-P02, N-P04); ten simultaneous booking clients
(N-P03, deferred by user decision); formal UVic/UVSS privacy-policy
compliance (N-S09); and any client-approved needs reporting.

These gaps are documented for portfolio transparency and must not be
presented as successful production acceptance tests.

## How results are captured

- `testing/test-results.md`: committed human-readable latest verification
  summary, including CI evidence and explicit test limitations.
- `testing/results/latest-run.md`: machine-generated Markdown case results
  (latest local run, or a downloadable GitHub Actions artifact).
- `testing/results/latest-run.json`: machine-readable result metadata for
  further analysis. Generated per run; intentionally not committed.
- CI fails if any new case fails and uploads both generated files even when
  assertions fail. Existing backend/React checks also run on each PR.

