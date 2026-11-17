-- Migration 003: Preserve term-specific enrollment verification decisions.
-- Run once after 001_core.sql and 002_auth.sql.
-- Existing current statuses remain in enrollment_verifications.
BEGIN;

CREATE TABLE enrollment_verification_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES profiles(id),
  term_id UUID NOT NULL REFERENCES terms(id),
  actor_id UUID REFERENCES profiles(id),
  previous_status TEXT CHECK (
    previous_status IS NULL OR previous_status IN ('pending','verified','rejected')
  ),
  new_status TEXT NOT NULL CHECK (new_status IN ('pending','verified','rejected')),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX enrollment_verification_events_student_term_idx
  ON enrollment_verification_events (student_id, term_id, occurred_at DESC);

CREATE INDEX eligibility_surveys_term_idx
  ON eligibility_surveys (term_id, submitted_at DESC);

COMMIT;
