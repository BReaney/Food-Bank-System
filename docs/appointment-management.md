# Appointment cancellation, rescheduling and shared availability

## Purpose

This milestone implements student-owned cancellation and rescheduling, a
staff-only view of booked appointments, and regularly refreshed capacity
for all authenticated users. The database remains the shared authority.

This is a fictional-account portfolio prototype, **not** a system
approved for real UVic student records or public deployment.

## What each role can see

- Students: times, capacity and remaining places in all listed slots;
  their **own** upcoming bookings, booking history and in-app activity.
  Students never receive another student's name, email or booking ID.
- Staff: current booked appointments across all students, including
  fictional names/emails, plus optional all-status booking history.
- Anonymous sessions cannot access either roster.

A capacity-one slot becomes Full after one booking; a capacity-four
slot remains open after one booking with three places left. The slot's
capacity and number of booked records determine what other students see.

## Consistency model

- PostgreSQL transactions commit booking changes with their event history.
- The existing slot_availability view calculates the latest booked_count
  and remaining_capacity using only status='booked' rows.
- Cancellation changes the booking to cancelled, releasing slot capacity
  and the once-per-week reservation.
- Rescheduling moves the **same booking ID** to a new slot, releasing the
  original space and reserving the destination space atomically.
- Source and destination slots are locked in consistent UUID order and
  the booking row is rechecked under lock.
- Every mutation revalidates the current database values. An outdated
  browser cannot force a full slot to become overbooked.
- Student and staff appointment panels poll every **five seconds**
  while visible, refresh on focus/visibility change, and students
  refresh immediately after each booking/cancellation/reschedule.
- The existing student eligibility panel, staff enrollment-verification
  roster, and staff directory now also refresh on this schedule, so
  staff decisions, surveys and new fictional profiles become visible
  to the authorized users without a manual page reload.
- All /api responses have Cache-Control: no-store.
- Polling is **not truly instantaneous**. Other open pages will typically
  reflect changes within five seconds. The server is authoritative.

## Visible, accessible error feedback

- When a student tries to book without an eligibility survey, staff verification, or another booking prerequisite, the backend's existing validation error appears in a **larger dark-red alert** at the top of the appointment page.
- The browser **scrolls the alert into view and moves keyboard focus to it** after an unsuccessful booking, cancellation, reschedule, or pickup edit. Reduced-motion users get an immediate rather than animated scroll.
- The same reusable action-error alert is used for account/profile actions and staff appointment-outcome updates. Other existing error notices also receive the clearer dark-red styling.
- **Background polling/load errors are styled but do not automatically scroll or steal focus**, to avoid repeatedly interrupting users during periodic refreshes.
- These are presentation-only changes: server-side booking eligibility and transaction rules are unchanged. The frontend navigation helper is tested with `npm run test:notice-navigation`.

## Endpoints

Student-only:
- GET /api/bookings — own future active bookings and cutoff metadata.
- GET /api/bookings/history — last 30 own bookings, including cancelled.
- GET /api/bookings/events — last 30 own booking events.
- POST /api/bookings/:bookingId/cancel — cancel a current booking.
- POST /api/bookings/:bookingId/reschedule — JSON body with slotId.
- POST /api/bookings — existing authenticated booking endpoint.

Staff-only:
- GET /api/staff/bookings — booked appointments across students, with
  identity, term and appointment time; limit/offset/search/term filters.
- Query status=booked (default) shows upcoming booked appointments.
- Query status=all shows full historical status records.

Both student and staff must be logged in. An attempt to cancel or
reschedule another student's booking returns 404 (or 403 if staff).
The route never uses a client-supplied student ID to determine ownership.

## Rules

- Cancellation and rescheduling allowed only when booking status is booked.
- The **original** appointment must be **more than**
  terms.cancellation_cutoff_hours ahead (default **24 hours**).
  The same cutoff applies to all student-initiated appointment edits:
  cancellation, rescheduling and selecting/changing a pickup person.
  It also blocks student edits/removals of approved dependents or
  pickup contacts if they would change an assigned near-term booking.
  Staff authorization withdrawals remain an immediate safety override.
- A rescheduled target must have remaining capacity, be open, within
  the associated term and within its advance-booking window.
- A student must have completed their survey and have verified
  enrollment **for the new target term**. Withdrawing a student's
  enrollment verification blocks new bookings and rescheduling, but
  intentionally does **not** cancel existing confirmed appointments.
  Student cancellations and authorized pickup edits remain subject to
  the usual appointment cutoff.
- One non-cancelled booking per student per Vancouver-local calendar
  week is enforced by the existing unique PostgreSQL index.
- Cancelled, completed and no-show records cannot be rescheduled.
- Rescheduling to the existing slot is rejected.

No new schema migration is needed: the existing bookings,
booking_events, appointment_slots and slot_availability are reused.

## Local setup

From the repository root with no uncommitted changes:

    git fetch origin
    git switch --track origin/feature/appointment-management

In backend and frontend separately:

    npm ci
    npm run dev

If dependencies are already installed, npm ci may be omitted.
Keep backend/.env with ENABLE_PROTOTYPE_AUTH=true and your fictional
student/staff credentials. Do not push the private .env.

## Browser verification

Use two different browser profiles (e.g. normal and private) so that
sessions do not overwrite each other's cookies. Create and verify two
fictional students using the earlier milestones, and staff should
approve both for a term and both should submit surveys.

1. Sign in as student A, book an open slot.
2. Sign in as student B, keep the slot list visible. After a few seconds,
   its remaining capacity should decrease, or it should display Full.
   Student B **must not** see student A's name or email.
3. Sign in as staff in a third browser profile. The Staff appointment
   roster **must** list student A's fictional name/email and appointment.
4. As student A, cancel a booking. Confirm the place reopens in B's view
   and staff's current roster stops listing it.
5. Book again and reschedule to another open slot. Observe that the
   previous slot reopens while the destination's free places decrease.
6. Check student A's own booking history and activity list. Student B
   must not see A's booking history or event details.
7. Use staff's All booking history filter to view cancelled bookings.
8. Attempt to change a booking after its configured cutoff; the server
   must reject it, even if a stale browser still displays a button.

The DEMO term seed normally uses capacity=4. To verify a slot becomes
Full after just one booking, you need a test slot with capacity=1.
The scripted test below creates its own capacity-one test slots.

## Automated integration test

Keep Express running and run from backend:

    npm run test:booking-management

The test creates a temporary fictional term, two fictional eligible
student accounts, and capacity-one slots. It checks sequential booking,
private visibility, staff visibility, cancellation, rescheduling,
capacity changes, the cutoff rule, and audit/event history. It cleans
up its test-only records afterward. The test is deliberately **not**
a concurrent-booking stress test, which was deferred.

GitHub Actions also runs it against a disposable PostgreSQL service.

## Limitations and follow-up milestones

- Activity confirmations are in-app, not email/SMS. RSD REQ-19
  (delivered confirmations) is **partially** implemented.
- Staff currently can view all students' bookings but cannot edit
  a student's appointment. Staff lifecycle actions, calendar slot
  creation/edit/closure, completed/no-show status and notifications
  are future work.
- Student availability is a list, not yet a full calendar grid.
- Real staff identity, enrollment verification, privacy, notifications,
  production hosting and operational security review are future work.
