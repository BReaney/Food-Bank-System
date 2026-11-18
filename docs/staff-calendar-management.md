# Staff calendar management — milestones 10 / REQ-20–22

**Local fictional-account prototype only.** Staff manage terms, slot schedules
and capacity without relying on SQL or pgAdmin after the migration.

## Requirements and scope

- RSD REQ-20: staff create term calendars with start/end dates, weekly
  available days and times, per-slot durations and capacities.
- RSD REQ-21: staff edit or close slots. Changes to occupied slot times
  produce session-private in-app notices; closing a slot cancels its
  active bookings in one transaction and writes a private notice per
  affected student. Audit and booking histories are retained.
- RSD REQ-22: overlapping open slots **within the same term** are rejected
  when staff create, edit, generate or reopen slots. Existing one-booking
  per Vancouver-local week, capacity, eligibility, advance notice and
  cancellation rules are still enforced for student bookings.
- Challenge statement: semester-based calendar with configurable time
  windows and capacity. Completion/no-show staff appointment workflows
  remain the next separate milestone.

### Notification delivery limitation

Private notices appear in the signed-in student's **Appointment schedule
notices** panel, which polls every ~5 seconds and refreshes on focus.
Students can mark notices read. This does **not** send email or SMS,
so the RSD's externally delivered notification expectation is not yet
fully satisfied. The later notification milestone will add delivery.

## Migration 005 (run once)

After pulling the branch, open pgAdmin connected to **foodbank_dev as
foodbank_app** and execute:

    database/migrations/005_staff_calendar.sql

Run migration 005 only **once**, after migrations 001–004. It adds
`student_notifications` and extends `booking_events.event_type` to
include `slot_updated`. It does not drop or reset bookings.

GitHub Actions runs migration 005 automatically on disposable PostgreSQL.

## New staff UI

Sign in as `staff.demo@example.com`, then go to **Staff calendar management**.

1. Create a term: unique uppercase code, display name, first/last date,
   minimum notice (>=7 days), maximum notice, and cancellation cutoff
   in hours. A term may span at most two years.
2. Select a term using **Term to manage**. You can edit its settings;
   term date/policy changes are blocked when it has active bookings.
   Term dates cannot exclude existing configured slots.
3. Create an individual appointment slot: Vancouver-local date/time,
   fixed duration (5–120 minutes, increments of 5) and capacity (1–100).
4. Generate repeating slots: choose a date range, weekdays, daily
   start/end hours, duration and capacity. The backend creates up to
   600 nonoverlapping slots per request **atomically**. If any slot
   conflicts or is invalid, none of them is created.
5. Edit slot start/duration/capacity. Capacity cannot be reduced below
   current booked seats. If booked, moving a slot is restricted to the
   same Vancouver-local week and must remain outside the configured
   cancellation cutoff. Affected students get individual notices.
   Slots with cancelled, completed or no-show booking history cannot
   have their dates/times changed; create a new slot rather than
   rewriting historical appointment dates.
6. Close a slot: after confirmation, the slot becomes unavailable
   and **all its active bookings are cancelled**. Each affected student
   gets a private in-app notice and a booking event, and staff action
   metadata is audited. This overrides the student's own cancellation
   cutoff; staff have to use care with closures.
7. Reopen a closed future slot: previous cancellations are **not**
   automatically reinstated. Students may book normally once reopened.
8. Use **Previous week**, **Next week**, **This week**, or the date picker
   to navigate the weekly planner. Appointment cards are positioned by
   their Vancouver-local day/time, with staff Edit/Close/Reopen actions
   on the selected card. Only the selected week's slots are retrieved
   (at most 500 per API request).

**Time zone:** Inputs are interpreted in `America/Vancouver` even if
the browser has a different local time zone. Avoid ambiguous times
around the autumn daylight-saving clock change; nonexistent spring
times are rejected. Real campus opening hours are staff-defined.

## Week-at-a-glance planner

The previous long month lists have been replaced by a reusable React
`WeeklyPlanner` grid modeled on a paper weekly organizer: Monday–Sunday
columns and times down the side. Both roles can move between weeks, jump
to a date, or return to the current week. The planner shows an empty
schedule when there are no slots, without hiding navigational controls.

The time labels and week boundaries use `America/Vancouver` (rather
than the browser's local timezone). The view automatically narrows its
vertical hours to the times scheduled in the selected week, avoiding a
needlessly long 24-hour view. Overlapping slots from separate terms
appear in side-by-side lanes.

Student cards distinguish open/full/closed/own-booking with visible
status text, and their detail panel retains the existing confirmed
dependent or pickup-contact booking flow. The staff detail panel retains
slot edit and close/reopen actions. Students can navigate to a new
week to view rescheduling alternatives.

The backend accepts a validated Monday `week=YYYY-MM-DD` parameter,
retains the legacy `month=YYYY-MM` filter, and rejects using both at
once. This UI change has no new schema changes or dependencies beyond
the already required staff-calendar migration 005.

## Student experience and privacy

- `GET /api/slots?week=YYYY-MM-DD` returns only that Vancouver-local
  **Monday–Sunday** week's upcoming slots, with timestamps, open/closed
  status, booked count and remaining capacity—no student names or IDs.
  The old optional `month=YYYY-MM` API filter remains supported for
  compatibility, but the new student UI uses the weekly planner.
- Students can still book, cancel and reschedule in their own account.
  Server rules—not stale browser buttons—decide what may be booked.
- Each affected student receives their own `student_notifications` row
  when staff move their booked slot or close it. Other students cannot
  read these messages; staff management is separately role-protected.
- The student's own upcoming appointment times and status update on
  the normal five-second refresh.

## Staff endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/staff/calendar/terms` | List terms and slot counts |
| POST | `/api/staff/calendar/terms` | Create term |
| PUT | `/api/staff/calendar/terms/:termId` | Edit term |
| GET | `/api/staff/calendar/slots?termId=UUID&week=YYYY-MM-DD` | List only one Monday–Sunday week |
| POST | `/api/staff/calendar/slots` | Create one slot |
| PUT | `/api/staff/calendar/slots/:slotId` | Edit time/duration/capacity |
| POST | `/api/staff/calendar/slots/:slotId/close` | Close and cancel active bookings |
| POST | `/api/staff/calendar/slots/:slotId/reopen` | Reopen without reinstating bookings |
| POST | `/api/staff/calendar/terms/:termId/generate` | Generate weekly slots |

Only staff can call these. `GET /api/notifications` and
`PATCH /api/notifications/:id/read` are student-only and derive
student identity exclusively from the authenticated session.

## Local verification

From the repository root (clean worktree):

    git switch main
    git pull --ff-only origin main
    git fetch origin
    git switch --track origin/feature/staff-calendar-management

After migration 005, run `npm run dev` in both backend and frontend.
Run `npm ci` first if the dependency executables are missing.

Use one Chrome profile for a fictional staff account, and separate
browser profiles for two independent fictional students.

Suggested manual checks:

1. Create a fictional term covering a few weeks next month.
2. Generate Monday/Wednesday/Friday slots from 09:00 to 11:00,
   each 20 minutes long, capacity 2. Use Next week or Jump to date
   to find those appointment cards in both weekly planners.
3. Try generating the same interval again—expect an overlap rejection,
   with no new slots added.
4. Have two eligible fictional students book the same capacity-2 slot.
   Verify both see it as Full and staff see the student identities
   only in their authorized appointment roster.
5. Try reducing slot capacity to 1—expect rejection.
6. Move the occupied slot by 20 minutes, within the same week and
   outside the cancellation cutoff. Both students should receive
   their own private notice and see updated appointment times.
7. Close that slot. Confirm the warning in the UI; both bookings
   should become cancelled and both students should see a closure
   notice, while other students see the closed slot but no identities.
8. Reopen the slot. Confirm it is available but does not silently
   restore previously cancelled reservations.
9. Use the week navigation to switch to an empty week and back. Check
   that a slot is rendered on the correct day and Vancouver-local hour,
   that the student's selection panel can book it, and that the staff
   selection panel can edit it without exposing other students' identities.
10. Verify the student role gets HTTP 403 if it tries staff calendar
    endpoints, and cannot mark another student's notice as read.

### Automated integration

With backend running and `foodbank_dev` configured:

    cd backend
    npm run test:calendar

The script temporarily creates a fictional term, students, slots and
bookings. It validates role restrictions, term/slot validation,
overlap rejection, recurring-generation atomicity, capacity safety,
student-only notices, occupied-slot updates, closure, event history,
staff audit records and reopening; then removes only test-owned data.

The test is sequential. Concurrent booking stress tests remain deferred
at the user's request.

## Remaining boundaries

- Both student and staff appointment views use a seven-column weekly
  planner with hourly guide lines, appointment cards, keyboard-accessible
  selection, and horizontal scrolling for small screens. This is a
  time-grid planner rather than a month list.
- The current in-app notification inbox is not outbound email/SMS.
- Staff complete/no-show appointment lifecycle and reporting remain
  separate milestones.
- Real operating hours, legal consent wording, secure hosting and privacy
  controls require UVSS policy approval before real-world deployment.
