-- UVSS Food Bank Booking System
-- Migration 001: first relational schema for the core booking workflows.
-- Run exactly once on a new database, as the foodbank_app database owner.
-- Dates/times: timestamptz stores instants; the backend converts local
-- food-bank appointment times using America/Vancouver.

BEGIN;

CREATE TABLE profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL CHECK (position('@' IN email) > 1),
  first_name TEXT NOT NULL CHECK (btrim(first_name) <> ''),
  last_name TEXT NOT NULL CHECK (btrim(last_name) <> ''),
  role TEXT NOT NULL DEFAULT 'student'
    CHECK (role IN ('student', 'staff')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Email addresses should be unique even if capitalization differs.
CREATE UNIQUE INDEX profiles_email_lower_unique
  ON profiles (lower(email));

CREATE TABLE terms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  minimum_notice_days INTEGER NOT NULL DEFAULT 7
    CHECK (minimum_notice_days >= 0),
  maximum_notice_days INTEGER NOT NULL DEFAULT 60
    CHECK (maximum_notice_days >= minimum_notice_days),
  cancellation_cutoff_hours INTEGER NOT NULL DEFAULT 24
    CHECK (cancellation_cutoff_hours >= 0),
  CHECK (ends_on >= starts_on)
);

-- Enrollment and survey completion are independent, per-term records.
CREATE TABLE enrollment_verifications (
  student_id UUID NOT NULL REFERENCES profiles(id),
  term_id UUID NOT NULL REFERENCES terms(id),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'verified', 'rejected')),
  verified_by UUID REFERENCES profiles(id),
  verified_at TIMESTAMPTZ,
  notes TEXT,
  PRIMARY KEY (student_id, term_id),
  CHECK (
    status <> 'verified'
    OR (verified_by IS NOT NULL AND verified_at IS NOT NULL)
  )
);

CREATE TABLE eligibility_surveys (
  student_id UUID NOT NULL REFERENCES profiles(id),
  term_id UUID NOT NULL REFERENCES terms(id),
  survey_version TEXT NOT NULL DEFAULT 'demo-v1',
  responses JSONB NOT NULL
    CHECK (jsonb_typeof(responses) = 'object'),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (student_id, term_id)
);

CREATE TABLE appointment_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  term_id UUID NOT NULL REFERENCES terms(id),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  is_open BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (term_id, starts_at),
  CHECK (ends_at > starts_at)
);

CREATE INDEX appointment_slots_start_idx
  ON appointment_slots (starts_at);

CREATE TABLE bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES profiles(id),
  slot_id UUID NOT NULL REFERENCES appointment_slots(id),
  -- Must be the Monday of the appointment's Vancouver-local week.
  -- The booking service derives it from the selected slot, not the client.
  week_start DATE NOT NULL
    CHECK (extract(isodow FROM week_start) = 1),
  status TEXT NOT NULL DEFAULT 'booked'
    CHECK (status IN ('booked', 'cancelled', 'completed', 'no_show')),
  booked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at TIMESTAMPTZ,
  CHECK (status <> 'cancelled' OR cancelled_at IS NOT NULL)
);

-- A student cannot have two non-cancelled bookings in one local
-- calendar week. Completed and missed pickups also use that week's limit.
CREATE UNIQUE INDEX bookings_student_week_unique
  ON bookings (student_id, week_start)
  WHERE status IN ('booked', 'completed', 'no_show');

CREATE INDEX bookings_slot_booked_idx
  ON bookings (slot_id)
  WHERE status = 'booked';

CREATE INDEX bookings_student_history_idx
  ON bookings (student_id, booked_at DESC);

-- Preserve the sequence of booking changes rather than losing history.
CREATE TABLE booking_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES bookings(id),
  actor_id UUID REFERENCES profiles(id),
  event_type TEXT NOT NULL
    CHECK (event_type IN ('created', 'cancelled', 'rescheduled',
                         'completed', 'no_show')),
  event_data JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(event_data) = 'object'),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX booking_events_booking_idx
  ON booking_events (booking_id, occurred_at);

-- Future staff actions will write an audit trail here.
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES profiles(id),
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id UUID,
  details JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(details) = 'object'),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A convenient read-only view for future calendar/API queries.
CREATE VIEW slot_availability AS
SELECT
  s.id,
  s.term_id,
  s.starts_at,
  s.ends_at,
  s.capacity,
  s.is_open,
  count(b.id)::integer AS booked_count,
  (s.capacity - count(b.id)::integer) AS remaining_capacity
FROM appointment_slots AS s
LEFT JOIN bookings AS b
  ON b.slot_id = s.id AND b.status = 'booked'
GROUP BY s.id;

COMMIT;
