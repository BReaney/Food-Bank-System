-- Demo data only. No real students, credentials, or identification documents.
-- Can be run after migration 001. Profiles are not authenticated users.

BEGIN;

INSERT INTO profiles (email, first_name, last_name, role)
VALUES
  ('alex.demo@example.com', 'Alex', 'Example', 'student'),
  ('staff.demo@example.com', 'Sam', 'Example', 'staff')
ON CONFLICT DO NOTHING;

INSERT INTO terms (
  code, name, starts_on, ends_on,
  minimum_notice_days, maximum_notice_days, cancellation_cutoff_hours
)
VALUES ('DEMO', 'Demonstration Term',
        CURRENT_DATE - 1, CURRENT_DATE + 120, 7, 60, 24)
ON CONFLICT (code) DO NOTHING;

INSERT INTO enrollment_verifications (
  student_id, term_id, status, verified_by, verified_at
)
SELECT student.id, term.id, 'verified', staff.id, now()
FROM profiles student
CROSS JOIN profiles staff
CROSS JOIN terms term
WHERE student.email = 'alex.demo@example.com'
  AND staff.email = 'staff.demo@example.com'
  AND term.code = 'DEMO'
ON CONFLICT (student_id, term_id) DO NOTHING;

INSERT INTO eligibility_surveys (
  student_id, term_id, survey_version, responses
)
SELECT student.id, term.id, 'demo-v1',
       '{"sample_answer":"fictional demonstration only"}'::jsonb
FROM profiles student CROSS JOIN terms term
WHERE student.email = 'alex.demo@example.com' AND term.code = 'DEMO'
ON CONFLICT (student_id, term_id) DO NOTHING;

INSERT INTO appointment_slots (term_id, starts_at, ends_at, capacity)
SELECT term.id,
       ((CURRENT_DATE + 10) + TIME '13:00')
          AT TIME ZONE 'America/Vancouver',
       ((CURRENT_DATE + 10) + TIME '13:20')
          AT TIME ZONE 'America/Vancouver',
       4
FROM terms term WHERE term.code = 'DEMO'
ON CONFLICT (term_id, starts_at) DO NOTHING;

COMMIT;
