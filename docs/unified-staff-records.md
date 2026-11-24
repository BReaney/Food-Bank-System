# Unified Staff Records Menu (RSD REQ-24–26)

This milestone builds on merged System Usage Reporting (PR #13). **Local-only
fictional prototype**. Student preferences later added by migration 007
are displayed here with no additional schema change or dependency.
There are no changes to booking, eligibility, calendar or appointment-outcome behavior.

## Staff workflow

Open **Unified staff records menu** near the top of the staff dashboard.
Search by student name or email, in a literal, case-insensitive, paginated
roster (25 per page). Search results show the student's **Domestic/International designation**
and **dietary restrictions** beneath the name/email. An empty result shows
exactly **No Records Found**.

Select **View record** to inspect the student's:

- Name, email, account creation date, domestic/international designation,
  and the full list of recorded dietary restrictions. Legacy unanswered fields
  show **Not provided**, which is distinct from an explicit **None**.
- Per-term enrollment decision and independent eligibility-survey submission
  (including a clear distinction between no decision recorded and pending).
- Enrollment decision timeline, including withdrawn or re-verified status.
- Every current and historical booking, paginated 25 per page, newest first.
  Each shows booking outcome, current appointment time, pickup designation,
  and booking event type/time. Reschedules reflect the latest slot.
- Current non-removed dependent registrations and third-party pickup contacts,
  including approval status and contact consent timestamp.

This view is read-only. Existing staff calendar, enrollment and household
panels remain responsible for updates.

## API and security

GET /api/staff/records?search=...&limit=25&offset=0

GET /api/staff/records/:studentId?limit=25&offset=0

Both use existing requireUser and requireRole("staff") middleware and the
existing local-only prototype gate. Unauthenticated requests return 401,
student sessions 403, invalid IDs/filters 400, and unknown student IDs 404.
Only profiles with role=student can be returned. No-cache HTTP responses
prevent personal data being stored by intermediate caches.

SQL values are parameterized. Name/email substring matching treats percent
and underscore characters literally, not as SQL wildcards. Page sizes and
offsets are bounded. A consistent repeatable-read database snapshot and
audit event are committed together for every successful search/view.

Audit action names:
- staff_records_searched: filter-present boolean + total result count.
- staff_student_record_viewed: student target ID + appointment page offset.

Audit JSON never includes names, emails, phone numbers, private survey answers,
dietary preferences or consent text. The records response likewise excludes raw survey responses,
password hashes, session tokens and consent text. Historical booking rows may
include the recorded pickup name, including for a subsequently removed contact.

## Manual local verification

1. Start the local PostgreSQL, backend and frontend with the existing setup
   commands. Use fictional demo students and staff only.
2. Log in as staff and search by name and email. Verify that the search result
   includes student designation and dietary restrictions, then select View record
   and verify that the fields match there. Check an international student with
   multiple restrictions, a student who selected None, and an older profile
   that has not supplied either field.
3. Check verified/rejected enrollment across terms and survey confirmation.
   Inspect appointment outcome and expandable booking-event timeline, and
   confirm current dependent and contact approval states.
4. Search for a nonsense string, verify **No Records Found**, and Clear.
   Test next/previous search and booking pages.
5. Sign in as a student in a second browser: the menu is not rendered.
   Direct requests to both staff endpoints must return 403 (logged out 401).
6. Inspect audit_logs for search and record views. No private contact data
   or survey responses should be in audit details.
7. Check keyboard-only control and small-screen stacked layout.

Integration test (backend running with provisioned demo accounts):

    npm run test:staff-records

Creates and deletes a fictional student, two terms, enrollment events, a
survey, a dependent, a contact, and two bookings. Checks authorization,
history, missing/invalid search, appointment paging and audit logging.
Search audit records are intentionally retained as staff-access history.

## Limits

No additional migrations or dependencies beyond migration 007 from the
student-preferences feature, and no changes to booking/cutoff rules.
Only existing recorded events are shown; removed contacts do not appear in
the active household lists. Historical reschedule slot details are not
reconstructed beyond stored event type/time. The under-three-second display
target and 1,100-user scale have not yet received dedicated load testing.
