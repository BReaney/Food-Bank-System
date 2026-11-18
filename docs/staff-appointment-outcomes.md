# Staff appointment outcomes — completed / no-show

This is a **small, staff-only milestone** for the UVSS food bank prototype.
Use fictional profiles and local development data only.

## Scope

- The challenge statement specifically asks staff to mark appointments
  **completed**, **no-show**, or rescheduled. This milestone implements
  completed and no-show, while keeping the existing student rescheduling
  feature; staff-initiated rescheduling is separate future work.
- This contributes recorded statuses for RSD REQ-23 usage reporting;
  aggregate charts and exports remain the future reporting milestone.
- No new database migration or dependencies: migration 001 already
  allows booking statuses completed and no_show, and booking_events
  stores event types. The existing audit_logs table records staff actions.

## What staff see

The **Staff appointment roster** now defaults to **Awaiting outcome**:
active appointments whose scheduled end time is in the past.
Staff can filter by term, search fictional student name/email, and
choose one of these views:

- Awaiting outcome: past appointments still in status booked.
- Upcoming active appointments: future booked appointments.
- Completed: recorded completed pickups.
- No-shows: recorded missed pickups.
- Cancelled: cancelled appointments.
- All booking history: all statuses, including still-booked past records.

For a past active appointment, staff see **Mark completed** and
**Mark no-show** buttons. They confirm the irreversible action in the
browser before it is submitted to the API. The booking is then removed
from the Awaiting outcome list and appears under its new status.

Staff can mark a booking only after its scheduled **end time** has
passed, and only if it is still booked. A cancelled, completed,
or no-show booking cannot be marked again (HTTP 409). Future
appointments are rejected server-side (HTTP 422), even if a malicious
client tries the endpoint directly.

## Backend endpoint

    POST /api/staff/bookings/:bookingId/outcome

JSON body (one of):

    {"outcome":"completed"}
    {"outcome":"no_show"}

Requires an authenticated **staff** session. Request parameters
are validated before database access. The transaction locks the slot
and booking, verifies the current status and end time, and then
writes the updated status, a booking_events row, and an audit_logs
row **together**. If any step fails, the transaction rolls back.

Booking history is retained, and both completed and no-show outcomes
continue counting toward the existing one-booking-per-week restriction.

## Student privacy and history

Only staff can mark outcomes or access the staff booking roster.
Students cannot see another student's status or identity. The
affected student will see **completed** or **no_show** in their
private booking history and event log, updated by existing polling.

No additional email or SMS is sent. Those remain part of the
future notification milestone.

## Setup

From a clean repository worktree:

    git switch main
    git pull --ff-only origin main
    git fetch origin
    git switch --track origin/feature/staff-appointment-outcomes

Run `npm run dev` inside `backend` and `frontend` in separate terminals.
Use `npm ci` first only if dependencies are missing.

**No new SQL migration is required.** Previous migrations 001–005
are enough.

## Local verification

1. Sign in as fictional staff.
2. Visit the Staff appointment roster and choose Awaiting outcome.
3. For a booking whose appointment has already ended, choose
   Mark completed and confirm. It should appear under Completed.
4. Repeat on a second ended appointment with Mark no-show.
5. The student should see these statuses in their own booking
   history. Another student must not see those booking records.
6. Check that future appointments have no outcome buttons, and
   cancelled/completed/no-show appointments cannot be marked twice.
7. Filter by term and search a fictional student's name/email.

**Why the roster may initially be empty:** staff scheduling correctly
prevents creating slots in the past, and students must book at least
seven days ahead. You won't have ended appointments until their
scheduled times pass. For automated verification now, run the test
script below; it temporarily creates fictional past appointments
directly in the local test database.

### Automated test

Keep Express running, then run in `backend`:

    npm run test:staff-outcomes

The test creates two fictional students, past and future appointment
fixtures, and a dedicated fictional term. It validates role access,
invalid inputs, premature outcome rejection, one-time completed/
no-show transitions, staff filters, student-only history, audit
events, and weekly uniqueness. It then cleans up the test records.

The same test runs in GitHub Actions using disposable PostgreSQL.
No concurrent booking stress testing is introduced, as requested.

## Future work

Staff correction/reopening of erroneously completed outcomes is not
included: edits to terminal states require an explicit policy and
additional audit design. Staff-created reschedules, outbound
notifications, usage reports and student record export are separate
milestones. The local fictional-data prototype is not production-ready.
