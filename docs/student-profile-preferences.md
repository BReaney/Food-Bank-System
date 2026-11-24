# Student designation and dietary preferences (prototype)

This feature adds two self-reported fields to the fictional student's **Create profile** and **My profile** screens.
It is **not an official UVic or UVSS form**, and is not appropriate for collection of real dietary or student-status information without a privacy review.

## Fields

| Field | Form control | Accepted values |
|---|---|---|
| Student designation | Required single-choice menu | `domestic`, `international` |
| Dietary restrictions | Required checkbox group (multiple choices) | `vegetarian`, `kosher`, `gluten-free`, `vegan`, `halal`, `none` |

**None is exclusive.** Choosing it clears other restrictions; choosing any restriction removes None. The server rejects unknown options, duplicates, empty arrays and combinations involving None. Students may select multiple actual restrictions.

## Database migration

Run [migration 007](../database/migrations/007_student_profile_preferences.sql) **once after migration 006**:

```powershell
psql -h localhost -U foodbank_app -d foodbank_dev -v ON_ERROR_STOP=1 -f database/migrations/007_student_profile_preferences.sql
```

Or execute the same SQL in pgAdmin while connected to `foodbank_dev` as the `foodbank_app` owner. Restart the backend afterward.

Two columns are added to `profiles`:

- `student_designation TEXT NULL` with a database check for the two allowed values. `NULL` means an **existing** student has not provided an answer; the migration does not guess one.
- `dietary_restrictions TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]` with database checks for allowed options and exclusive `none`. The **empty array** means no answer was supplied (legacy profile), **not** "no restrictions". A deliberate answer is `['none']`.

Current stored profile names, email, role, sessions, appointments, eligibility and household information are unchanged. Staff demo accounts are not required to set these student-only fields.

## API behavior

- **`POST /api/auth/register`**: requires `studentDesignation` and `dietaryRestrictions`, in addition to existing registration fields. Invalid or missing values get HTTP 400.
- **`GET /api/auth/me`** and **`GET /api/profile/me`**: include `student_designation` and `dietary_restrictions` for the logged-in account only.
- **`PATCH /api/profile/me`**: student may update either or both fields alongside required names. Existing name-only API callers continue to work, preserving stored preference values if omitted. Staff cannot set student fields. Role/email are not mutable through this endpoint.
- **Staff student records/reports**: unchanged. Neither new preference is added to staff record search or usage reports, and preference values are not written to audit/event details. This avoids increasing exposure without a clear requirement.

Example fictional registration payload:

```json
{
  "email": "student-fixture@example.test",
  "firstName": "Demo",
  "lastName": "Student",
  "password": "FictionalExamplePassword123",
  "studentDesignation": "international",
  "dietaryRestrictions": ["vegetarian", "gluten-free"]
}
```

## Testing and scope

- The existing authentication smoke test now covers valid registration, duplicate/unknown/empty/repeated dietary values, invalid student status, profile updates, reloaded session values, staff role restrictions, and changing restrictions to **None**.
- Existing registration fixtures are updated to supply explicit fictional preferences; the backend and frontend builds and acceptance suites continue to run in CI.
- The frontend dietary-selection helper has focused regression tests and is included in CI via `npm run test:profile-preferences`.
- The original RSD did not specify these new optional prototype categories. No eligibility, booking or staff approval policy is changed by this feature.

**Privacy:** These labels may reflect sensitive personal circumstances in real usage. This prototype must continue using fictional records only. Real collection would require data-minimization, access/retention and policy decisions before adoption.
