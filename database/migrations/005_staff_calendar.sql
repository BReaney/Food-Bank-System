-- Migration 005: staff calendar changes and private student notices.
-- Apply exactly once after migration 004; never reset existing data.
BEGIN;

CREATE TABLE student_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES profiles(id),
  booking_id UUID REFERENCES bookings(id),
  actor_id UUID REFERENCES profiles(id),
  category TEXT NOT NULL CHECK (category IN ('slot_time_changed', 'slot_closed')),
  message TEXT NOT NULL CHECK (length(btrim(message)) BETWEEN 5 AND 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at TIMESTAMPTZ
);
CREATE INDEX student_notifications_unread_idx
  ON student_notifications(student_id, created_at DESC);

ALTER TABLE booking_events DROP CONSTRAINT booking_events_event_type_check;
ALTER TABLE booking_events ADD CONSTRAINT booking_events_event_type_check
  CHECK (event_type IN ('created', 'cancelled', 'rescheduled',
                       'completed', 'no_show', 'pickup_updated',
                       'slot_updated'));

COMMIT;
