# In-App Appointment Notifications (RSD REQ-19)

**Scope:** Local-only fictional UVSS Food Bank prototype. No email/SMS,
real student identities, or external notification provider.

## What was added

An authenticated student's **Appointment notifications** inbox now includes:

- `booking_confirmed` after successfully booking a new slot.
- `booking_cancelled` after the student cancels a booked appointment.
- `booking_rescheduled` after successfully moving a booking to a new slot.
- Existing `slot_time_changed` staff calendar notices.
- Existing `slot_closed` staff cancellation notices.

These are **persisted in PostgreSQL**, not browser-only success messages.
They are inserted in the *same database transaction* as the successful
booking change, so failed or rolled-back changes never generate a
misleading confirmation. The staff-closed-slot path still writes exactly
one `slot_closed` notice for each affected student; it does **not**
create a second student-cancellation notice.

Messages use the `America/Vancouver` time zone. They contain no student,
dependent, or pickup-contact names, no phone/email addresses, and no survey
or consent data. The student sees their own booking's timing and status.

## Database migration — required once

After pulling the feature branch and before starting the API, connect in
pgAdmin to your existing local `foodbank_dev` database as `foodbank_app`.
Open and run **`database/migrations/006_booking_notifications.sql` once**.

Do not re-run migrations 001–005 or reset your existing data. Migration
006 only extends the allowed `student_notifications.category` values
and creates an inbox paging index; existing messages and read states
remain unchanged. CI applies it automatically to the **disposable** test
database. This migration is not applied by `npm run dev`.

If psql is already available in your PowerShell PATH, run from the
repository root:

    psql -h localhost -U foodbank_app -d foodbank_dev -v ON_ERROR_STOP=1 -f database/migrations/006_booking_notifications.sql

## API

All endpoints require the existing local prototype gate, valid session
cookie, and `student` role. `Cache-Control: no-store` prevents caching.

- `GET /api/notifications?limit=25&offset=0`: returns
  `notifications` (newest first), `unreadCount` (across all pages), and
  `pagination` with total, limit, offset, hasNext, hasPrevious.
  Limit 1–100; offset 0–1,000,000; malformed and repeated params
  return HTTP 400.
- `PATCH /api/notifications/:id/read`: idempotently marks a
  student-owned notice read; someone else's/unknown ID gets HTTP 404.
- `PATCH /api/notifications/read-all`: marks all unread notices owned
  by the logged-in student read, returns `updatedCount`. Calling again
  returns zero.

Staff and anonymous requests receive 403/401 respectively. No client
parameter is accepted for the student account ID. Existing 5-second
polling and focus refresh remain. After a successful booking/cancel/
reschedule action, the React appointments panel also immediately
signals the inbox to refresh. Older notices are paginated rather than
silently dropped after the first 50.

## Review on the local fictional database

1. Update local `main`, switch to
   `feature/complete-in-app-notifications`. Run migration 006 once
   in the local DB as described above.
2. Start backend and frontend in separate terminals using
   `npm run dev`, then open `http://localhost:5173`.
3. Sign in as `alex.demo@example.com` (fictional) or a newly
   registered fictional student. Ensure their current term has a survey
   and staff-approved enrollment before booking.
4. Book an available weekly slot. The inbox should soon show
   **Booking confirmed** with the correct Vancouver-local time.
   Try a duplicate or full-slot booking; it should fail and **not**
   add a new notice.
5. Cancel the reservation before the cutoff; confirm **Booking cancelled**
   and that the booking disappears from upcoming appointments while
   remaining visible in appointment history.
6. Make a second booking and reschedule it to an eligible available
   slot. Check **Booking rescheduled**, original/new time, preserved
   booking ID, and unchanged access rules.
7. Mark a notice read; the unread count decreases. Use **Mark all as
   read**; the count becomes zero. Refresh the page and confirm read
   states persist. If there are more than 25 messages, try Older/Newer.
8. In a different browser profile, sign in as fictional staff; verify
   staff cannot request the private notifications API. Anonymous
   requests get HTTP 401. Student B must not see or mark Student A's
   notifications.
9. In staff calendar, move or close a booked slot using existing
   controls. The existing staff schedule-change/closure notice should
   still appear in Student A's inbox; a closed slot should not result
   in a redundant `booking_cancelled` notice.

Backend automated regression test (backend running):

    cd backend
    npm run test:booking-management
    npm run test:household
    npm run test:calendar
    npm run build

Frontend build (from repository root):

    cd frontend
    npm run build

The extended booking management smoke test covers confirmation, cancel,
reschedule, failed actions, owner isolation, staff/anonymous denial,
read/read-all, unread counts and paging past 50 records. Fixtures use
fictional accounts and clean up their created notifications.

## Deliberate prototype limitations

- **No outbound email/SMS**: receipt in a private in-app inbox satisfies
  this prototype's notification workflow but does not deliver a message
  outside the application.
- The inbox is polled and refreshed on page focus, not implemented with
  real-time WebSockets or push alerts.
- No multi-device/browser notification push when the user is logged out.
- Notifications are currently retained until explicitly managed by a
  future data retention policy; do not use the prototype for real users.
- Staff marking appointments completed/no-show remains visible in private
  booking history; a separate outcome inbox message is not required by
  REQ-19 and is not created here.
