# Milestone 6 — Term Surveys and Staff Enrollment Verification

This feature is **fictional and local-only**. Do not use real student names,
student IDs, university credentials, actual proof-of-enrollment documents
or sensitive eligibility information. The real institution's verification
and survey questions have **not** been provided.

## Requirements and policy choices

The RSD specifies:
- REQ-6–9: display a current-term eligibility survey, store answers
  with term and timestamp, and reject incomplete submissions;
- REQ-8: prevent booking until current term eligibility is complete;
- staff must separately verify enrollment;
- staff actions on records must be logged;
- eligibility must expire automatically by term, without deleting history.

The challenge statement says an annual survey with current-term eligibility,
whereas the RSD calls for a survey each term. **We use per-term surveys
for this prototype pending client clarification.**

Our placeholder survey asks (1) fictional enrollment affirmation,
(2) fictional household category, and (3) fictional-data confirmation.
These are NOT official UVSS questions or approval criteria. Survey
submission alone must never authorize booking. A staff verification alone
must never authorize booking either.

**No SQL migration is required** for this milestone: migration 001
already created \`terms\`, \`enrollment_verifications\`, \`eligibility_surveys\`
and \`audit_logs\`. If the existing local database was created using 001
and 002, leave its schema and records intact.

## Setup on Windows

From the repository root, after committing/stashing local work:

\`\`\`bash
git fetch origin
git switch --track origin/feature/term-eligibility-and-enrollment
\`\`\`

If already on the branch, use \`git pull --ff-only origin
feature/term-eligibility-and-enrollment\`.

Keep \`backend/.env\` configured with PostgreSQL credentials,
\`ENABLE_PROTOTYPE_AUTH=true\`, \`FRONTEND_ORIGIN=http://localhost:5173\`,
and the distinct \`DEMO_STAFF_PASSWORD\` and \`DEMO_STUDENT_PASSWORD\`
used in the previous milestone. No new dependencies or secrets are needed.

Start Express from \`backend\`: \`npm run dev\`.
Start React from \`frontend\`: \`npm run dev\`.

Open \`http://localhost:5173\`.

## Manual scenario A: new student

1. Register \`taylor-eligibility@example.test\` (fictional) and sign in.
2. Open the **Term eligibility and survey** panel.
3. Select the **Demonstration Term**.
4. Observe **Survey: Not submitted**, **Staff enrollment review: pending**,
   and **Booking eligibility: Not yet eligible**.
5. Try leaving a required survey field blank: the form must reject it.
6. Fill the fictional survey and submit. Observe survey submitted,
   but **not yet eligible** until staff verifies.
7. Sign out.

## Manual scenario B: staff verification

1. Sign in as \`staff.demo@example.com\`.
2. Open **Staff enrollment verification**, select the **Demonstration Term**.
3. Search for the fictional student's email or name.
4. Observe **Survey: Submitted** and **Enrollment: pending**.
5. Click **Verify**; the enrollment status changes to verified.
6. Optionally click **Reject** or **Mark pending** to observe that the
   decision is reversible and each change is audited.
7. Return it to **verified**, then sign out.

## Manual scenario C: booking

1. Sign in as the student from scenario A.
2. In the term panel confirm both checks are complete.
3. The corresponding available booking button becomes enabled.
4. Book a future slot within the configured notice window. The booking
   should persist after refreshing the page.
5. Try to book another slot in the same local calendar week: the backend
   must reject it even if browser validation is bypassed.

Note: The seed script's single slot is 10 days after the day you seeded
the database. If it has passed or has become full, create a new fictional
term slot through pgAdmin for testing. Do **not** rerun migration 001.

## Automated checks

In a separate backend terminal with Express running:

\`\`\`bash
npm run test:auth
npm run test:eligibility
npm run build
\`\`\`

In \`frontend\`, run \`npm run build\`.

The eligibility test creates two new random fictional student accounts,
checks required fields, duplicate submission, student/staff access
restrictions, audit records, approval independence, actual bookings, and
the weekly uniqueness rule. The test assumes at least two free spaces
in a future fixture slot. GitHub Actions runs it against a clean,
throwaway PostgreSQL database and demonstrates this scenario safely.

## API endpoints

| Method | Endpoint | Access |
|---|---|---|
| GET | /api/terms | Authenticated student or staff |
| POST | /api/terms/:termId/survey | Student, once per term |
| GET | /api/staff/enrollment?termId=UUID&search=...&offset=0 | Staff |
| PATCH | /api/staff/enrollment/:studentId | Staff |
| GET | /api/bookings | Student |
| POST | /api/bookings | Student; requires survey plus verified enrollment |

Example staff PATCH JSON:

\`\`\`json
{
  "termId": "<UUID of selected term>",
  "status": "verified"
}
\`\`\`

Allowed statuses: \`pending\`, \`verified\`, and \`rejected\`. The backend
determines the actor from the HTTP-only session, not from request JSON.

## Database inspection in pgAdmin

\`\`\`sql
SELECT p.email, t.code, ev.status, ev.verified_at
FROM enrollment_verifications AS ev
JOIN profiles AS p ON p.id = ev.student_id
JOIN terms AS t ON t.id = ev.term_id
ORDER BY t.code, p.email;

SELECT p.email, t.code, s.survey_version, s.submitted_at
FROM eligibility_surveys AS s
JOIN profiles AS p ON p.id = s.student_id
JOIN terms AS t ON t.id = s.term_id
ORDER BY s.submitted_at DESC;

SELECT a.occurred_at, a.action, p.email AS staff_email,
       a.target_id, a.details
FROM audit_logs AS a
LEFT JOIN profiles AS p ON p.id = a.actor_id
WHERE a.action = 'enrollment_status_changed'
ORDER BY a.occurred_at DESC;
\`\`\`

## Security and release limitations

- The prototype's browser UI and API are local-only, not approved for deployment.
- Fictional staff verification means a human marks a record verified;
  there is no university registrar integration.
- The survey is a placeholder, not an actual eligibility determination.
- Students can only see their own term status and submit their own survey.
- Staff-only endpoints use role middleware and parameterized SQL.
- Decisions are logged, but full operational audit review/retention policy
  remains to be designed.
- Per-term status is isolated; an approval for term A never automatically
  carries over to term B.
- Cancellation/rescheduling, dependents, third-party pickups, staff schedule
  management and reporting remain future milestones.
