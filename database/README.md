# Database setup — Milestone 2

The UVSS Food Bank challenge and RSD require separate student/staff accounts,
term-based eligibility, fixed appointment slots, weekly booking restrictions,
and staff records. This first migration implements the core relational tables.

**Status:** development prototype, not approved for real student information.
Use only synthetic data. Authentication, authorization, and the transactional
booking API are **not** implemented by this migration.

## Windows local installation

1. Install PostgreSQL Server, pgAdmin 4, and Command Line Tools from
   https://www.postgresql.org/download/windows/ .
2. Save the \`postgres\` superuser password that you choose in the installer.
   Keep the default local port 5432 unless it is occupied.
3. Open pgAdmin, connect to the default local server, select the \`postgres\`
   database and open Query Tool.
4. Run these commands, choosing a **new strong local development password**:

\`\`\`sql
CREATE ROLE foodbank_app WITH LOGIN PASSWORD 'REPLACE_WITH_STRONG_LOCAL_PASSWORD';
CREATE DATABASE foodbank_dev OWNER foodbank_app;
\`\`\`

For a correct least-privilege setup, connect to \`foodbank_dev\` **as
foodbank_app** when running migrations, not as the postgres superuser.
In pgAdmin, register another server using Host \`localhost\`,
Maintenance Database \`foodbank_dev\`, Username \`foodbank_app\`, and
the password chosen above.

## Create tables and load example data

From the repository root, if \`psql\` is available in PATH:

\`\`\`powershell
psql -h localhost -U foodbank_app -d foodbank_dev -v ON_ERROR_STOP=1 -f database/migrations/001_core.sql
psql -h localhost -U foodbank_app -d foodbank_dev -v ON_ERROR_STOP=1 -f database/seed/demo.sql
\`\`\`

Alternatively use pgAdmin's Query Tool while connected as \`foodbank_app\`.
Open each SQL file, execute the migration first and the seed second.
**Run the migration only once** on a new database.

To inspect the example appointment slots, run:

\`\`\`sql
SELECT starts_at, capacity, booked_count, remaining_capacity
FROM slot_availability
ORDER BY starts_at;
\`\`\`

There should be one four-capacity demonstration slot with four remaining
places and no bookings.

## Notes on business rules

- Monday is currently the first day of the booking week. The application
  will calculate it from the selected slot in \`America/Vancouver\`.
- The index \`bookings_student_week_unique\` prevents more than one active,
  completed, or no-show booking per student per week. Cancellation releases
  the week's reservation.
- Capacity > 0 is enforced by SQL. **Preventing the last place from being
  overbooked requires a backend transaction locking its slot row and
  checking the number of booked rows before inserting.** This is future work.
- An eligibility survey submission is not evidence of enrollment: staff
  enrollment verification is maintained separately for each term.
- The RSD says 'survey each term' while the challenge describes an annual
  survey plus current-term eligibility. The prototype models term-specific
  responses until that policy is confirmed.
- No login endpoint exists yet. Demo profiles must not be treated as
  authenticated sessions or proof of student status.
- The remaining dependent, pickup contact and consent entities belong in
  a following migration after we confirm the exact collection/retention policy.
- The schema's foreign keys do not themselves verify that \`student_id\`
  belongs to a student or \`verified_by\` belongs to a staff member.
  The future authenticated service must enforce these rules.
- The schema alone cannot verify that a slot belongs inside its term,
  that a booking's week corresponds to the slot, or that the slot has
  remaining capacity. The booking service will validate these with the
  database transaction.

## Future Express connection

From \`backend/\` install \`pg\`, \`dotenv\`, and \`@types/pg\`.
Store connection credentials in \`backend/.env\` (already ignored by Git),
not in source control. Do not use the postgres superuser from the API.
