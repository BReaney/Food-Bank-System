# Milestone 6: Staff enrollment verification and term eligibility surveys

This milestone implements the requirements in the RSD section 2.1.2
(REQ-6 to REQ-9) and the staff's manual verification responsibility.
**Only use fictional accounts and data.** This is a local portfolio prototype.

The original challenge statement discusses an annual survey, but the RSD
states students complete a survey each term. This prototype implements
**one survey per term**, and enrollment is separately verified per term.
The client must resolve the survey cadence and approve the actual questions
before any use with real students.

## Files

- \`database/migrations/003_enrollment_history.sql\`
  - Records every manual enrollment status change in a permanent history table.
  - Existing \`audit_logs\` table stores the same staff action at a high level.
- \`backend/src/routes/eligibility.ts\`
  - Student status and term survey submission.
- \`backend/src/routes/enrollmentStaff.ts\`
  - Staff-only enrollment roster and approval/rejection actions.
- \`backend/src/routes/terms.ts\`
  - Authenticated terms lookup for students and staff.
- \`frontend/src/StudentEligibility.tsx\` and \`StaffEnrollment.tsx\`
  - Accessible forms and status displays.
- \`backend/src/scripts/eligibilitySmokeTest.ts\`
  - Integration checks with fictional accounts against disposable PostgreSQL in CI.

## Local setup

1. From your repository folder:
   \`\`\`bash
   git fetch origin
   git switch --track origin/feature/eligibility-verification
   \`\`\`
   If the branch is already checked out, use \`git pull --ff-only origin feature/eligibility-verification\`.
2. Open pgAdmin connected to \`foodbank_dev\` as \`foodbank_app\`.
3. In Query Tool, run \`database/migrations/003_enrollment_history.sql\` exactly once.
   **Do not rerun migrations 001 or 002.** Existing profiles, slots, and
   bookings remain in place.
4. Keep \`ENABLE_PROTOTYPE_AUTH=true\` and \`FRONTEND_ORIGIN=http://localhost:5173\`
   in your private \`backend/.env\`.
5. Run \`npm run dev\` in \`backend\` and in \`frontend\` in separate terminals.

## Student test path

1. Sign in with a fictional student created during the previous milestone.
2. View the new **Enrollment and eligibility** panel.
3. Choose the demo term and submit both required confirmations.
4. Confirm the UI now shows **Survey: submitted** but
   **Enrollment: pending** until staff acts.
5. Student cannot successfully book an appointment before both conditions
   are satisfied. The API returns HTTP 403.

Students may inspect earlier term statuses. Only active or upcoming terms
accept a new survey; prior survey records remain intact.

## Staff test path

1. Sign out and sign in as \`staff.demo@example.com\`.
2. Select the DEMO term in **Enrollment verification (staff)**.
3. Find the fictional new student and click **Verify**.
4. Staff can also **Reject** or **Reset to pending**. Every actual status
   change is persisted to \`enrollment_verification_events\` and \`audit_logs\`.
5. Sign back in as the student and observe the verified status.
6. Attempt booking a future eligible appointment; the existing booking
   transaction requires BOTH term survey and verified enrollment.

Staff may verify enrollment independently of survey completion.
The real system needs evidence-checking procedures and explicit authorization
by the organization. No real student identifier or document upload is used.

## API endpoints

| Method | Path | Role | Description |
|---|---|---|---|
| GET | /api/terms | Authenticated | List terms |
| GET | /api/eligibility/terms | Student | Own per-term statuses |
| POST | /api/eligibility/surveys/:termId | Student | Submit demo survey (once/term) |
| GET | /api/staff/enrollments?termId=... | Staff | Students and term statuses |
| PUT | /api/staff/enrollments/:studentId/:termId | Staff | Set status |

Staff PUT JSON format:
\`\`\`json
{"status":"verified"}
\`\`\`
Other valid statuses: \`rejected\`, \`pending\`. The server determines
the acting staff member through the session cookie, not request JSON.

Student survey JSON format:
\`\`\`json
{"confirmAccurate":true,"understandVerification":true}
\`\`\`
These are placeholders for workflow testing, not a final needs assessment.
Do not add sensitive answers without an approved privacy design.

## Verify database rows in pgAdmin

\`\`\`sql
SELECT p.email, t.code, ev.status, ev.verified_at
FROM enrollment_verifications ev
JOIN profiles p ON p.id = ev.student_id
JOIN terms t ON t.id = ev.term_id
ORDER BY t.code, p.email;

SELECT p.email, t.code, s.submitted_at, s.survey_version
FROM eligibility_surveys s
JOIN profiles p ON p.id = s.student_id
JOIN terms t ON t.id = s.term_id
ORDER BY s.submitted_at DESC;

SELECT e.occurred_at, p.email AS student_email,
       e.previous_status, e.new_status
FROM enrollment_verification_events e
JOIN profiles p ON p.id = e.student_id
ORDER BY e.occurred_at DESC;

SELECT action, occurred_at, details
FROM audit_logs WHERE action = 'enrollment_status_changed'
ORDER BY occurred_at DESC;
\`\`\`

## Run automated tests locally

From \`backend\` with the backend server already running:
\`\`\`bash
npm run test:auth
npm run test:eligibility
npm run build
\`\`\`
From \`frontend\`:
\`\`\`bash
npm run build
\`\`\`

The integration tests create one new fictional student and a booking
and append audit rows in your local development database. GitHub Actions
uses a disposable PostgreSQL service, not your actual data.

## Limitations and next steps

- This UI is **not** the final UVSS eligibility questionnaire.
- The staff demo approval is a manual test decision, not a real university
  enrollment check. Email ownership and real identity are not verified.
- No automatic university student records integration is planned: that
  is explicitly outside the challenge scope.
- One survey record per term suffices for the current simplified booking
  gate; the original RSD and challenge differ on annual vs term survey
  cadence, and that requires client resolution.
- Updating verification status blocks **new** bookings immediately when
  not verified; it does not automatically cancel an existing booking.
  Existing-booking review/revocation and notifications are future work.
- There is no staff term creation UI yet; terms are configured through
  the database migration/seed during this milestone.
- No dependent/third-party approvals, cancellations/rescheduling,
  no-show/completed management, reporting exports, live deployment, or
  production-grade security and privacy controls yet.
