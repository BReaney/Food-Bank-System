# Page-based navigation — UI-only milestone

## Scope

Previously, all student and staff panels were stacked in one long dashboard.
The app now shows **one selected feature page at a time**, with a persistent
role-specific menu. It moves existing React components without changing
their forms, API endpoints, authorization rules, database schema, or business
logic. No router package or additional dependencies are needed.

URLs use a hash, so linking and the browser's Back/Forward navigation work
in the existing local Vite/Express setup without changing server routes.

### Student menu

| Page | URL | Original component |
| --- | --- | --- |
| Book & manage appointments | `/#/student/appointments` | `StudentAppointments` (calendar, upcoming, history) |
| Eligibility & enrollment | `/#/student/eligibility` | `StudentEligibility` |
| Dependents & pickup contacts | `/#/student/household` | `StudentHousehold` (both existing forms) |
| Notifications | `/#/student/notifications` | `StudentNotifications` |
| My profile | `/#/student/profile` | The existing profile editor from `App` |

### Staff menu

| Page | URL | Original component |
| --- | --- | --- |
| Calendar & slots | `/#/staff/calendar` | `StaffCalendar` |
| Appointment roster | `/#/staff/appointments` | `StaffAppointments` |
| Enrollment verification | `/#/staff/enrollment` | `StaffEnrollment` |
| Household approvals | `/#/staff/household` | `StaffHousehold` |
| Student records | `/#/staff/records` | `StaffRecords` |
| Usage reports | `/#/staff/reports` | `StaffReports` |
| My profile | `/#/staff/profile` | The existing profile editor from `App` |

The account identity and Sign out button remain visible on every page.
The navigation uses landmark markup and `aria-current="page"`; keyboard
focus moves to the newly selected page heading. Navigation links wrap on
desktop and form a compact grid on mobile. The wide weekly planner retains
its scrollable seven-column layout.

Directly opening an unknown route, an obsolete URL, or another role's page
falls back to the currently authenticated role's default page. These
client-side checks improve the UI only. **All actual authorization still
happens in Express**; a student cannot use a staff hash to gain access.

When switching pages, the prior feature component unmounts. As with
ordinary page navigation, **unfinished, unsaved form entries may be reset**.
All saved records remain in PostgreSQL and are reloaded when returning.

## Local setup and test

There are **no new database migrations** or environment variables.

From the repository root, with a clean Git working tree:

    git fetch origin
    git switch main
    git pull --ff-only origin main
    git switch --track origin/feature/page-based-navigation

If the feature branch already exists locally:

    git switch feature/page-based-navigation
    git pull --ff-only origin feature/page-based-navigation

Start the existing PostgreSQL database. Then:

Backend terminal:

    cd backend
    npm run dev

Frontend terminal (from repository root):

    cd frontend
    npm run dev

Open `http://localhost:5173` and sign in with existing **fictional**
test accounts only.

### Student manual review

1. Confirm the menu includes *Book & manage appointments*,
   *Eligibility & enrollment*, *Dependents & pickup contacts*,
   *Notifications*, and *My profile*.
2. Open each tab and verify it contains the **same** controls and data as
   the previous long dashboard.
3. Book or inspect an existing appointment, switch to Household, return
   to Appointments and confirm persisted bookings still appear.
4. Open Notifications and verify private booking notices/read states.
5. Edit profile names and verify the saved values persist after changing
   pages or refreshing.
6. Use the browser Back and Forward buttons between two or more pages;
   refresh on a direct `/#/student/household` link.
7. Test that visiting `/#/staff/records` as a student redirects to the
   student appointments page, without rendering any staff components.

### Staff manual review

1. Sign in as fictional staff in a separate browser profile.
2. Check the seven staff menu links and that student-only links are absent.
3. Open Calendar; create/edit slots as usual, then view the appointment
   roster, enrollment, household approvals, student records and reports.
4. Verify term selection, search/pagination, reports/CSV and status
   changes still work. Return to each page after navigating away.
5. Use browser Back/Forward, refresh a deep link such as
   `/#/staff/reports`, and visit an invalid student route; it must
   fall back to the staff calendar instead of exposing student panels.

### Mobile and keyboard review

1. In browser developer tools, use widths around 360px and 390px.
   Check menu labels are readable and navigation links remain reachable.
2. Tab through the menu, use Enter to activate a page, and verify
   visible focus and the highlighted `aria-current="page"` state.
3. At full width, verify the weekly calendar and staff records layout
   remain usable. On smaller screens, the calendar itself still scrolls
   horizontally as before.
4. Sign out from any page and ensure private controls are removed.

### Automated tests

From `frontend`:

    npm run test:navigation
    npm run test:calendar-state
    npm run build

From `backend`:

    npm run build

GitHub Actions also runs the **new navigation test** and every previous
full-stack integration suite. The navigation test checks complete menu
coverage, stable bookmark URLs, role-safe unknown-link fallbacks, and
route uniqueness.

## Boundaries

- No booking policies, eligibility requirements, household behavior,
  reporting formulas, notification delivery, persistence, or auth APIs
  have been changed.
- No database migration or dependency installation is needed.
- Client-side page visibility is not a substitute for backend access control.
- This PR deliberately does not redesign the contents of the feature
  panels or introduce a new workflow.
