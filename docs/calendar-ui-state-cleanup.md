# Cleanup: stale staff calendar data and reschedule selections

This is a narrow frontend-only cleanup on top of merged PR #11.
No database migration, API change, authentication change or new dependency.

## Finding 3 — Out-of-order staff calendar responses

Before: `StaffCalendar` fetched the terms and slots on each term/week
selection and on a five-second interval, but did not cancel previous
requests or associate slot results with the selected term/week.
An older request could overwrite the visible calendar after navigation.

After:

- Each refresh effect owns an `AbortController`; unmounting, changing
  term/week or triggering a successful staff mutation aborts old fetches.
- `api()` forwards the signal to the browser fetch. Both API results
  are applied only if the signal is still active. Polling remains
  five seconds while visible and also runs on focus.
- Every stored slot result is tagged with its source **term ID** and
  Vancouver-local **Monday week**. The planner renders it only if
  those keys match the currently selected term and week. That
  prevents stale slots even during the brief interval before the
  previous effect has cleaned up.
- The planner shows a loading message rather than a false empty schedule
  when a new week is still being fetched.
- Switching a term or week resets the selected staff slot and any
  in-progress slot edit, preventing accidental actions on a slot from
  a previously selected context. Switching terms also resets the
  separate term editing form.

## Finding 4 — Reschedule target retained across week navigation

Before: `StudentAppointments` kept the selected reschedule target
per booking ID in `choices`. Changing weeks did not clear it, so a
hidden ID might stay selected even if the option list changed.

After:

- Changing the displayed week clears all reschedule target choices
  and the selected booking slot card.
- The student calendar also stores the source week with its slot
  response; slots from any other week are hidden until the new week
  loads, with a loading message.
- A rescheduling choice is considered valid only if its slot ID is
  still in that booking's displayed alternative list. This list
  excludes the current slot, closed slots and slots without capacity.
  Invalid IDs cause the select to clear and disable the submit
  button. The server keeps enforcing ownership, term eligibility,
  capacity, advance notice and change cutoff.

## Tests

Run from `frontend`:

    npm run test:calendar-state
    npm run build

Node 24's built-in test runner executes the guards' pure-function tests
without third-party dependencies. CI runs those tests before the
existing backend auth/eligibility/booking/household/calendar/outcome
integration suites against disposable fictional PostgreSQL.

### Manual browser regression

1. Staff: create or choose two fictional terms with different slots.
   Rapidly switch A/B/A and move several weeks with Previous/Next.
   Only the selected term and week must ever appear, and its slot
   selection must reset. The first transition shows a loading state.
2. Staff: select Edit on a slot, then change terms or weeks. Editing
   state must be reset, not applied to the old slot inadvertently.
3. Student: choose a reschedule target for an upcoming editable booking.
   Navigate to another week; the target select must clear and
   `Reschedule appointment` must disable until a visible target is
   selected in the new week.
4. With two fictional students in separate browser profiles, have
   one book the targeted slot so its last place disappears. When
   availability refreshes, the other student's stale target must
   clear; a request cannot be submitted without an available option.
5. Confirm booking, cancellation, pickup authorization, staff calendar
   editing, and completion/no-show still work as before.

## Scope deliberately unchanged

- Term calendars do not overlap, by user policy; no change to the
  cross-term overlap validation discussed in Finding 5.
- Notification pagination, consent retention, overnight appointments,
  and deferred concurrency testing are outside this prototype cleanup.
- No file outside frontend code, focused tests, the existing CI
  workflow, and this documentation is modified.
