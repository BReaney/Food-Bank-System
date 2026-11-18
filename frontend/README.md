# Frontend — React + TypeScript + Vite

This is the browser frontend of the **[Food Bank Booking System](../README.md)**, an independent, unofficial **personal-development** portfolio prototype **not affiliated with UVic or UVSS**.

For **first-time installation**, follow the [root README](../README.md#run-locally); this frontend needs a running PostgreSQL-backed Express API, not just the Vite development server.

## Run the frontend

From the repository's `frontend/` folder:

```powershell
npm ci
npm run dev
```

Open **http://localhost:5173**. The frontend's API calls target **http://localhost:3001**, so also start the backend from `backend/` with `npm run dev`.

The backend uses a local-only prototype gate and the exact permitted frontend origin (`http://localhost:5173` by default); if Vite selects a different port because 5173 is occupied, free that port rather than assuming the API origin rules will work unchanged.

## Commands

| Command | Description |
|---|---|
| `npm run dev` | Start Vite development server |
| `npm run build` | Type-check and create a production-style build artifact locally (not a production deployment) |
| `npm run preview` | Preview the generated Vite bundle; the API still needs the expected development origin |
| `npm run lint` | Run ESLint |
| `npm run test:calendar-state` | Test calendar state and stale-response guards |
| `npm run test:navigation` | Test role-specific links and routing fallbacks |

## Organization

- `src/App.tsx` — session-aware composition and navigation.
- `src/pageNavigation.ts` — role-specific page identifiers and bookmarkable hash paths.
- `src/Student*.tsx` — student eligibility, household, notifications and appointments.
- `src/Staff*.tsx` — staff enrollment, records, reporting, scheduling, roster and approvals.
- `src/WeeklyPlanner.tsx`, `calendarDates.ts`, `calendarStateGuards.ts` — weekly calendar logic and date helpers.
- `src/auth.css`, `src/index.css` — current page and form styles.
- `tests/` — frontend regression tests.

API authorization is **not enforced by hidden frontend pages**. The Express backend validates every user session, role and ownership rule. Use fictional test data only.

See [Architecture](../docs/architecture.md), [Testing](../testing/README.md), and the [full project README](../README.md).
