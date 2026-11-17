# Staff pagination and search — milestone

The staff enrollment roster and the staff-only student directory now use
**server-side pagination**, instead of returning only the first 200 or 100
students. This supports the RSD's expected 1,100+ student profiles.

The implementation uses **only fictional local test accounts**. No real
student information is involved.

## Changes

- `backend/src/utils/rosterPagination.ts`: shared validation of `search`,
  `limit` and `offset`.
- `GET /api/staff/enrollments?termId=<uuid>&search=<text>&limit=25&offset=0`
  returns an enrollment roster for the requested term.
- `GET /api/staff/profiles?search=<text>&limit=25&offset=0`
  returns the general student directory.
- `frontend/src/StaffEnrollment.tsx` has term selection, search,
  result counts and page navigation, while retaining staff
  verification/deny/reset functionality.
- `frontend/src/StaffDirectory.tsx` adds paged search to the general
  student directory.
- `backend/src/scripts/staffPaginationSmokeTest.ts` covers the two APIs.

## API contract

Both GET endpoints require a logged-in **staff** account (HTTP 403 for
students). All parameters are validated on the server:

| Parameter | Default | Allowed |
|---|---|---|
| `termId` | none | Required UUID for enrollment roster |
| `search` | empty | Literal substring up to 100 characters |
| `limit` | 25 | Whole number 1 to 100 |
| `offset` | 0 | Whole number 0 to 1,000,000 |

Names and email addresses are searched case-insensitively.
Unlike SQL LIKE patterns, `%` and `_` are treated as literal characters.
Server-side ordering uses last name, first name, email, then unique profile
ID, ensuring predictable pagination even for repeated names.

Successful response shape:

```json
{
  "students": [
    {
      "id": "<fictional UUID>",
      "email": "taylor@example.test",
      "first_name": "Taylor",
      "last_name": "Example",
      "enrollment_status": "pending",
      "survey_submitted_at": null,
      "verified_at": null
    }
  ],
  "pagination": {
    "limit": 25,
    "offset": 0,
    "total": 225,
    "hasNext": true,
    "hasPrevious": false
  }
}
```

For `/api/staff/enrollments`, the response also has `term` metadata.
For `/api/staff/profiles`, student entries have `role` instead of the
enrollment-specific fields.

`total` is the number of matching students before LIMIT/OFFSET are applied.
A page past the end returns an empty `students` array and the same total.
Malformed parameters return HTTP 400. Missing terms return HTTP 404.

## Try it locally

1. Ensure your worktree is clean, then run:
   ```bash
   git fetch origin
   git switch --track origin/feature/staff-pagination
   ```
2. **No database migration required.** Keep the PostgreSQL and fictional
   account settings from the previous milestones.
3. Run `npm run dev` from `backend` and `frontend` in separate terminals.
4. Sign in as `staff.demo@example.com` at `http://localhost:5173`.
5. In **Enrollment verification**, select DEMO and use the new search input.
   Try a fictional surname or part of an email, then Search/Clear.
6. Navigate Previous/Next when there are multiple result pages.
   Verify/Reject/Reset status still works and refreshes the current page.
7. In **Staff-only student directory**, repeat search and page navigation.

To exercise more than one page without creating 26 student accounts manually,
keep Express running, then from `backend` run:

```bash
npm run test:pagination
```

This script temporarily creates 225 fictional student profiles, checks
pagination, search, invalid inputs, role restrictions and empty pages, then
**deletes only those 225 test profiles**. It does not delete pre-existing
students, approvals, appointments, or credentials. The test needs the
`DEMO_STAFF_PASSWORD` and `DEMO_STUDENT_PASSWORD` configured locally.

Run `npm run build` from both `backend` and `frontend`.
GitHub Actions also runs `test:pagination` using disposable PostgreSQL.

## Why the database does the paging

- `COUNT(*)` supplies total number of matching students.
- The data query uses `ORDER BY ... LIMIT ... OFFSET ...`.
- Search and term IDs are SQL parameters; users cannot inject SQL.
- The maximum page size is 100 even if a caller sends `limit=100000`.
- Changing term/search resets the React page to the beginning.
- Fetch requests are cancellable so stale responses do not override
  newer search results.

## Remaining limitations

- Offset paging may skip/repeat rows if profiles are created/renamed while
  a staff member moves between pages. This is acceptable for the current
  prototype; cursor/keyset pagination is an option if needed at larger scale.
- Count and page queries are separate: extremely concurrent database changes
  can make totals momentarily differ from the returned rows.
- No dedicated database search index yet (fine for the ~1,100-user target,
  but consider trigram indexing at much larger scale).
- Real-data privacy requirements, authentication hardening and staff record
  access policy are still required before public deployment.
