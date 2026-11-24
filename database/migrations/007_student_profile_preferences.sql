-- Migration 007: optional legacy values and validated new student profile fields.
-- Apply exactly once after 006_booking_notifications.sql. No existing data is overwritten.
-- A NULL designation and empty dietary array mean "not yet supplied" for older accounts.
-- This prototype uses fictional information only; do not collect real dietary data.
BEGIN;

ALTER TABLE profiles
  ADD COLUMN student_designation TEXT
    CHECK (student_designation IN ('domestic', 'international')),
  ADD COLUMN dietary_restrictions TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]
    CHECK (
      dietary_restrictions <@ ARRAY[
        'vegetarian', 'kosher', 'gluten-free', 'vegan', 'halal', 'none'
      ]::TEXT[]
      AND cardinality(dietary_restrictions) <= 6
      AND (NOT ('none' = ANY(dietary_restrictions))
           OR cardinality(dietary_restrictions) = 1)
    );

COMMENT ON COLUMN profiles.student_designation IS
  'Fictional prototype only: domestic/international self-designation; NULL is legacy unspecified.';
COMMENT ON COLUMN profiles.dietary_restrictions IS
  'Fictional prototype only: selected dietary options; empty means legacy unspecified; none is exclusive.';

COMMIT;
