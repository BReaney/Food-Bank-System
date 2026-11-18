-- Migration 006: Complete the existing private student notification inbox.
-- Apply ONCE after 005_staff_calendar.sql to the existing local foodbank_dev.
-- Existing staff-created slot-change notices and their read state are retained.
BEGIN;

ALTER TABLE student_notifications
  DROP CONSTRAINT student_notifications_category_check;

ALTER TABLE student_notifications
  ADD CONSTRAINT student_notifications_category_check
  CHECK (category IN (
    'slot_time_changed',
    'slot_closed',
    'booking_confirmed',
    'booking_cancelled',
    'booking_rescheduled'
  ));

-- Supports a student's paginated newest-first inbox without scanning
-- unrelated students' notifications.
CREATE INDEX student_notifications_inbox_idx
  ON student_notifications(student_id, created_at DESC, id DESC);

COMMIT;
