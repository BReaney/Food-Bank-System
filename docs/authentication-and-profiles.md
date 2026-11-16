# Authentication and Profiles — local prototype

## Why this milestone exists

RSD REQ-1–5: students register, edit their own details, duplicates and
incomplete input are rejected, and staff accounts have a separate role.
RSD security REQ-5–8: authenticate users and prevent students from
accessing other students' private records or management endpoints.

This implementation uses **fictional** \`@example.test\` or \`@example.com\`
addresses. It **does not** verify email ownership, current UVic enrollment,
or staff employment. It is NOT suitable for production.

## 1. Update your working copy

\`\`\`bash
git fetch origin
git switch --track origin/feature/auth-and-profiles
\`\`\`

(If the branch is already checked out locally, just pull it normally.)

## 2. Run the new SQL migration

In pgAdmin, connect as \`foodbank_app\` to the \`foodbank_dev\` database.
Run \`database/migrations/002_auth.sql\` exactly once.

Do not run \`001_core.sql\` again. Existing fictional profiles and
bookings will remain intact.

## 3. Configure the backend

Add these settings to your existing **private** \`backend/.env\`:

\`\`\`dotenv
ENABLE_PROTOTYPE_AUTH=true
FRONTEND_ORIGIN=http://localhost:5173

DEMO_STAFF_PASSWORD=REPLACE_WITH_DISTINCT_STRONG_PASSWORD
DEMO_STUDENT_PASSWORD=REPLACE_WITH_ANOTHER_STRONG_PASSWORD
\`\`\`

Keep your existing \`PGHOST\`, \`PGPORT\`, \`PGUSER\`, \`PGPASSWORD\`,
and \`PGDATABASE\` values. Never commit the real \`.env\`.

The demonstration passwords must differ and have at least 12 characters.
They are only for fictional accounts.

## 4. Provision known fictional accounts

From \`backend\`:

\`\`\`bash
npm run seed:demo-accounts
\`\`\`

This creates/updates hashed credentials for the existing
\`staff.demo@example.com\` (staff) and \`alex.demo@example.com\` (student)
profiles. It only runs against a locally hosted \`foodbank_dev\` database.
It does not print passwords.

**Note:** Running it again resets both demo account passwords, but
does not remove profile or appointment history. Only rerun when needed.

Staff registration is deliberately **not** available through the
public web form. A developer provisions fictional staff through this
local trusted script. An actual system would use staff invitation,
identity verification and administrator approval.

## 5. Start the servers

From \`backend\` run \`npm run dev\`. From \`frontend\` run
\`npm run dev\` in another terminal. Open \`http://localhost:5173\`.

The application allows:

- Register a new fictional student (example: \`taylor@example.test\`).
- Sign in or out.
- View/edit your own profile's first and last names.
- See your own future bookings, and request a booking if eligibility
  and enrollment have been confirmed for the selected term.
- Sign in as demo staff to inspect a limited student directory.

Because new student accounts are NOT automatically enrolled or
survey-confirmed, booking should be rejected until the separate
staff verification and survey workflows are implemented.
The pre-seeded \`alex.demo@example.com\` student already has demo
verification and survey data for the \`DEMO\` term.

## 6. Automated smoke checks

Keep the Express server running. From \`backend\`, run:

\`\`\`bash
npm run test:auth
npm run build
\`\`\`

From \`frontend\`, run:

\`\`\`bash
npm run build
\`\`\`

The smoke script checks anonymous access, registration, duplicate
rejection, invalid login, a successful session, profile editing,
student/staff permission separation and logout. Each run creates
one new fictional test student.

## 7. Inspect tables in pgAdmin

\`\`\`sql
SELECT email, first_name, last_name, role
FROM profiles ORDER BY created_at DESC;

SELECT p.email, c.created_at, c.updated_at
FROM auth_credentials AS c
JOIN profiles AS p ON p.id = c.profile_id;

SELECT p.email, s.created_at, s.expires_at
FROM auth_sessions AS s
JOIN profiles AS p ON p.id = s.profile_id;
\`\`\`

Do not export or display password hashes unnecessarily. Session
tokens are only stored as hashes; the raw session cookie is never
readable by JavaScript in the browser.

## 8. Design and security notes

- Credentials live in \`auth_credentials\`; names/roles in \`profiles\`.
- Password hashing uses Node's built-in \`scrypt\` with a unique random salt.
- Secure random tokens are issued as HTTP-only, SameSite=Lax session cookies.
- Only SHA-256 hashes of those tokens are stored in PostgreSQL.
- API authorization uses the server-resolved session identity, not a
  student ID submitted by the React client.
- Staff routes require server-verified role = \`staff\`.
- Booking routes require server-verified role = \`student\`.
- State-changing requests check the allowed development Origin.
- All application routes except health/debug are disabled outside
  a local environment and when \`ENABLE_PROTOTYPE_AUTH\` is not true.
- The project is intentionally **not ready for deployment with real
  students**. Before launch: verified university identity and enrollment,
  staff-invitation approval, password reset/verification, rate limiting,
  better session lifecycle, CSRF architecture for actual domains,
  monitoring, vulnerability review, and retention/privacy policy.
- Authentication does NOT grant enrollment eligibility. That's a
  separate workflow, and the backend still checks it before booking.

## Endpoints

| Method | Path | Access |
|---|---|---|
| POST | /api/auth/register | Local, creates student only |
| POST | /api/auth/login | Local |
| GET | /api/auth/me | Logged-in student or staff |
| POST | /api/auth/logout | Local |
| GET | /api/profile/me | Logged-in owner |
| PATCH | /api/profile/me | Logged-in owner |
| GET | /api/staff/profiles | Staff only |
| GET | /api/slots | Logged in |
| GET | /api/bookings | Student only |
| POST | /api/bookings | Student only, eligibility required |
