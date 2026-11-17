# Local demo bookings — Milestone 4

**This is a learning/demo endpoint only, not an authenticated production booking service.**

The endpoint uses one hardcoded fictional account, `alex.demo@example.com`,
and works only when explicitly enabled in a local development process.
Never use real student data here or deploy with demo mode enabled.

## Setup

1. Run database migration `database/migrations/001_core.sql` and then
   `database/seed/demo.sql` against your local PostgreSQL database.
   Do not re-run the initial migration if you already ran it.
2. In `backend/.env`, keep your existing PostgreSQL connection settings and add:

```dotenv
ENABLE_DEMO_BOOKING=true
```

3. Restart the Express server from `backend` using `npm run dev`.
4. Start React from `frontend` using `npm run dev`.
5. Browse to `http://localhost:5173`.

The browser sends only `{ "slotId": "<UUID from /api/slots>" }` when
creating a booking. **The client cannot select a student account.**

## API

- `GET /api/slots`: all upcoming slots, including their remaining capacity
- `GET /api/bookings`: upcoming bookings for the fictional demo student
- `POST /api/bookings`: creates a reservation for that student

The two demo booking endpoints return HTTP 404 unless
`ENABLE_DEMO_BOOKING=true` and `NODE_ENV` is not `production`.
They also reject non-loopback requests. This is NOT a substitute for
authentication, authorization, rate limiting, and security review.

## Example

Choose a slot ID from `GET http://localhost:3001/api/slots`.
With PowerShell:

```powershell
Invoke-RestMethod -Uri "http://localhost:3001/api/bookings" `
  -Method POST -ContentType "application/json" `
  -Body '{"slotId":"REPLACE_WITH_REAL_UUID"}'
```

Successful response: HTTP 201 and a `booking` object.
Typical rejections: HTTP 400 (invalid UUID), 403 (eligibility),
404 (missing slot), 409 (weekly limit/full slot),
422 (invalid booking window or term).

## Database verification in pgAdmin

```sql
SELECT b.id, p.email, b.status, b.week_start, s.starts_at
FROM bookings AS b
JOIN profiles AS p ON p.id = b.student_id
JOIN appointment_slots AS s ON s.id = b.slot_id
WHERE p.email = 'alex.demo@example.com'
ORDER BY b.booked_at DESC;

SELECT starts_at, capacity, booked_count, remaining_capacity
FROM slot_availability
ORDER BY starts_at;

SELECT event_type, occurred_at
FROM booking_events
ORDER BY occurred_at DESC;
```

The demo seed creates a future slot with capacity 4, provided it was
run recently enough. Booking it once leaves 3 places. Booking again
in the same week should return HTTP 409 and must not add a new row.

## How transactions protect the data

- A checked-out `pg` client runs `BEGIN` / `COMMIT` / `ROLLBACK`.
- `SELECT ... FOR UPDATE OF s` serializes reservations of the same slot.
- The transaction checks the slot, term, enrollment, survey, weekly rule,
  and capacity before inserting both a booking and a history event.
- The unique partial index from migration 001 prevents two non-cancelled
  bookings for the same student in the same Vancouver-local week, even
  when two requests target different slots.
- Other SQL clients could bypass the API's capacity rules. Before
  production, restrict direct write permissions or move enforcement to
  a database function/trigger, and add concurrent integration tests with
  multiple authorized test students.

## Important limitations

- No actual student authentication yet.
- No cancel/reschedule endpoint yet.
- No notification emails or staff dashboard yet.
- An ordinary survey submission is treated as complete for demo purposes;
  actual survey validation and eligibility confirmation remain future work.
- The seven-day minimum and maximum booking horizon are based on exact
  elapsed time from the server clock. Confirm final cutoff semantics with
  the client.
- Current-term approvals are modeled by per-term records.
- Only use the synthetic demo data and review access restrictions before
  deployment.
