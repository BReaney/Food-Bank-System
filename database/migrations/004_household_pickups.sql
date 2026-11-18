-- Migration 004: student-owned dependents, delegated pickup contacts and
-- explicit consent. Apply ONCE to foodbank_dev as foodbank_app.
-- No real student information may be used in this local-only prototype.
BEGIN;

CREATE TABLE dependent_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES profiles(id),
  full_name TEXT NOT NULL CHECK (
    length(btrim(full_name)) BETWEEN 2 AND 100
  ),
  relationship TEXT NOT NULL CHECK (
    relationship IN ('child', 'partner', 'family_member', 'other')
  ),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'denied')),
  reviewed_by UUID REFERENCES profiles(id),
  reviewed_at TIMESTAMPTZ,
  removed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, id),
  CHECK (
    (reviewed_by IS NULL AND reviewed_at IS NULL)
    OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  )
);
CREATE INDEX dependent_requests_student_idx
  ON dependent_requests(student_id, removed_at, created_at DESC);
CREATE INDEX dependent_requests_review_idx
  ON dependent_requests(status, created_at) WHERE removed_at IS NULL;

CREATE TABLE pickup_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES profiles(id),
  full_name TEXT NOT NULL CHECK (
    length(btrim(full_name)) BETWEEN 2 AND 100
  ),
  contact_method TEXT NOT NULL CHECK (contact_method IN ('phone', 'email')),
  contact_value TEXT NOT NULL CHECK (
    length(btrim(contact_value)) BETWEEN 5 AND 160
  ),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'denied')),
  consent_version TEXT NOT NULL,
  consent_text TEXT NOT NULL,
  consent_given_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by UUID REFERENCES profiles(id),
  reviewed_at TIMESTAMPTZ,
  removed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, id),
  CHECK (
    (reviewed_by IS NULL AND reviewed_at IS NULL)
    OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  )
);
CREATE INDEX pickup_contacts_student_idx
  ON pickup_contacts(student_id, removed_at, created_at DESC);
CREATE INDEX pickup_contacts_review_idx
  ON pickup_contacts(status, created_at) WHERE removed_at IS NULL;

-- Minimal, non-sensitive event metadata. Names/phone/email are never
-- written to audit/event JSON; the owned current row holds those fields.
CREATE TABLE household_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES profiles(id),
  actor_id UUID NOT NULL REFERENCES profiles(id),
  record_type TEXT NOT NULL CHECK (record_type IN ('dependent', 'contact')),
  record_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (
    action IN ('requested', 'created', 'edited', 'removed', 'status_changed')
  ),
  previous_status TEXT,
  new_status TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX household_events_student_idx
  ON household_events(student_id, occurred_at DESC);
CREATE INDEX household_events_record_idx
  ON household_events(record_type, record_id, occurred_at DESC);

-- Existing reservations default to student pickup. Composite foreign keys
-- ensure an appointment can never reference another student's records.
ALTER TABLE bookings
  ADD COLUMN pickup_kind TEXT NOT NULL DEFAULT 'self'
    CHECK (pickup_kind IN ('self', 'dependent', 'third_party')),
  ADD COLUMN pickup_dependent_id UUID,
  ADD COLUMN pickup_contact_id UUID,
  ADD CONSTRAINT bookings_pickup_dependent_owner_fk
    FOREIGN KEY (student_id, pickup_dependent_id)
    REFERENCES dependent_requests(student_id, id),
  ADD CONSTRAINT bookings_pickup_contact_owner_fk
    FOREIGN KEY (student_id, pickup_contact_id)
    REFERENCES pickup_contacts(student_id, id),
  ADD CONSTRAINT bookings_pickup_exclusive_check CHECK (
    (pickup_kind = 'self'
      AND pickup_dependent_id IS NULL AND pickup_contact_id IS NULL)
    OR (pickup_kind = 'dependent'
      AND pickup_dependent_id IS NOT NULL AND pickup_contact_id IS NULL)
    OR (pickup_kind = 'third_party'
      AND pickup_contact_id IS NOT NULL AND pickup_dependent_id IS NULL)
  );

-- Track changes to the designated person without destroying booking history.
ALTER TABLE booking_events
  DROP CONSTRAINT booking_events_event_type_check;
ALTER TABLE booking_events
  ADD CONSTRAINT booking_events_event_type_check CHECK (
    event_type IN ('created','cancelled','rescheduled','completed',
                   'no_show','pickup_updated')
  );
CREATE INDEX bookings_pickup_dependent_idx
  ON bookings(pickup_dependent_id) WHERE pickup_dependent_id IS NOT NULL;
CREATE INDEX bookings_pickup_contact_idx
  ON bookings(pickup_contact_id) WHERE pickup_contact_id IS NOT NULL;

COMMIT;
