import express from "express";
import type { PoolClient } from "pg";
import { pool } from "../db.js";
import { requireUser, requireRole } from "../security/sessions.js";

// Staff-only aggregate reporting. Intentionally no names, emails, identifiers
// for individual students, survey responses, or contact details in results.
export const staffReportsRouter = express.Router();
staffReportsRouter.use(requireUser, requireRole("staff"));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ZONE = "America/Vancouver";

interface ReportTerm {
  id: string;
  code: string;
  name: string;
  starts_on: string;
  ends_on: string;
}
interface Totals {
  total: number;
  booked: number;
  completed: number;
  no_show: number;
  cancelled: number;
  students_served: number;
  awaiting_outcome: number;
}
interface WeeklyRow {
  week_start: string;
  booked: number;
  completed: number;
  no_show: number;
  cancelled: number;
  total: number;
}
interface PickupBreakdown {
  self: number;
  dependent: number;
  third_party: number;
}
interface HouseholdBreakdown {
  none: number;
  one: number;
  two_or_more: number;
}
interface UsageReport {
  term: ReportTerm;
  fromDate: string;
  toDate: string;
  generatedAt: string;
  timeZone: string;
  totals: Totals;
  weekly: WeeklyRow[];
  completedPickupTypes: PickupBreakdown;
  servedStudentsByCurrentDependents: HouseholdBreakdown;
  needsReportingAvailable: false;
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE.test(value)) return false;
  const date = new Date(value + "T12:00:00Z");
  return !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value;
}

class ReportError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function errorResponse(res: express.Response, error: unknown): void {
  if (error instanceof ReportError) {
    res.status(error.status).json({ error: error.message });
  } else {
    console.error("Staff usage report failed:", error);
    res.status(500).json({ error: "Unable to generate usage report" });
  }
}

// Every metric covers the scheduled appointment's LOCAL date, not the time
// when the student made or cancelled the booking. A reschedule moves the
// booking into the new appointment date, so no booking is double-counted.
const filteredBookingsSql = `
  FROM bookings AS b
  JOIN appointment_slots AS s ON s.id = b.slot_id
  WHERE ($1::text = 'all' OR s.term_id = NULLIF($1::text,'all')::uuid)
    AND s.starts_at >= ($2::date::timestamp AT TIME ZONE 'America/Vancouver')
    AND s.starts_at < (($3::date + 1)::timestamp AT TIME ZONE 'America/Vancouver')
`;

// Use one repeatable-read snapshot. The booking status can change while staff
// review a report; all JSON and CSV sections must describe ONE consistent
// committed database state.
async function buildUsageReport(
  termId: string, requestedFrom: string | undefined,
  requestedTo: string | undefined
): Promise<UsageReport> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");

    // RSD: per-term reports. Challenge: optional annual report spanning
    // successive, nonoverlapping terms. "all" always needs explicit dates.
    let term: ReportTerm;
    if (termId === "all") {
      if (!requestedFrom || !requestedTo) {
        throw new ReportError(400, "An all-terms report requires both dates");
      }
      term = {
        id: "all", code: "ALL", name: "All terms",
        starts_on: requestedFrom, ends_on: requestedTo
      };
    } else {
      const found = await client.query<ReportTerm>(
        `SELECT id, code, name,
                to_char(starts_on, 'YYYY-MM-DD') AS starts_on,
                to_char(ends_on, 'YYYY-MM-DD') AS ends_on
         FROM terms WHERE id = $1`,
        [termId]
      );
      if (!found.rows[0]) {
        throw new ReportError(404, "The selected term was not found");
      }
      term = found.rows[0];
    }

    const fromDate = requestedFrom ?? term.starts_on;
    const toDate = requestedTo ?? term.ends_on;
    if (!validDate(fromDate) || !validDate(toDate) ||
        fromDate > toDate) {
      throw new ReportError(400, "Enter a valid start and end date (YYYY-MM-DD)");
    }
    if (termId !== "all" &&
        (fromDate < term.starts_on || toDate > term.ends_on)) {
      throw new ReportError(422, "The report date range must stay within the selected term");
    }
    if (termId === "all" &&
        (Date.parse(toDate) - Date.parse(fromDate)) / 86400000 > 366) {
      throw new ReportError(400,
        "An all-terms report may cover at most 367 inclusive calendar dates");
    }

    const values = [termId, fromDate, toDate];

    const totalRows = await client.query<Totals>(
      `SELECT
          COUNT(*)::integer AS total,
          COUNT(*) FILTER (WHERE b.status='booked')::integer AS booked,
          COUNT(*) FILTER (WHERE b.status='completed')::integer AS completed,
          COUNT(*) FILTER (WHERE b.status='no_show')::integer AS no_show,
          COUNT(*) FILTER (WHERE b.status='cancelled')::integer AS cancelled,
          COUNT(DISTINCT b.student_id) FILTER
            (WHERE b.status='completed')::integer AS students_served,
          COUNT(*) FILTER
            (WHERE b.status='booked' AND s.ends_at <= NOW())::integer
              AS awaiting_outcome
        ` + filteredBookingsSql,
      values
    );

    const weeklyRows = await client.query<WeeklyRow>(
      `WITH weeks AS (
         SELECT generate_series(
           date_trunc('week', $2::date::timestamp),
           date_trunc('week', $3::date::timestamp),
           INTERVAL '1 week'
         )::date AS week_start
       ), weekly_bookings AS (
         SELECT b.id, b.status,
                date_trunc('week',
                  s.starts_at AT TIME ZONE 'America/Vancouver')::date
                  AS week_start
         ` + filteredBookingsSql + `
       )
       SELECT
         to_char(w.week_start,'YYYY-MM-DD') AS week_start,
         COUNT(b.id) FILTER (WHERE b.status='booked')::integer AS booked,
         COUNT(b.id) FILTER (WHERE b.status='completed')::integer AS completed,
         COUNT(b.id) FILTER (WHERE b.status='no_show')::integer AS no_show,
         COUNT(b.id) FILTER (WHERE b.status='cancelled')::integer AS cancelled,
         COUNT(b.id)::integer AS total
       FROM weeks AS w
       LEFT JOIN weekly_bookings AS b ON b.week_start = w.week_start
       GROUP BY w.week_start
       ORDER BY w.week_start ASC`,
      values
    );

    const pickupRows = await client.query<PickupBreakdown>(
      `SELECT
         COUNT(*) FILTER (WHERE b.status='completed'
                           AND b.pickup_kind='self')::integer AS self,
         COUNT(*) FILTER (WHERE b.status='completed'
                           AND b.pickup_kind='dependent')::integer AS dependent,
         COUNT(*) FILTER (WHERE b.status='completed'
                           AND b.pickup_kind='third_party')::integer AS third_party
       ` + filteredBookingsSql,
      values
    );

    // A CURRENT (not historical) household indicator. Avoid equating
    // a person's relationship/dependent count with an uncollected needs
    // assessment. Each served student appears exactly once in one bucket.
    const householdRows = await client.query<HouseholdBreakdown>(
      `WITH served AS (
         SELECT DISTINCT b.student_id
         ` + filteredBookingsSql + ` AND b.status='completed'
       ), approved_counts AS (
         SELECT served.student_id, COUNT(d.id)::integer AS dependents
         FROM served
         LEFT JOIN dependent_requests AS d
           ON d.student_id=served.student_id
          AND d.status='confirmed' AND d.removed_at IS NULL
         GROUP BY served.student_id
       )
       SELECT
         COUNT(*) FILTER (WHERE dependents=0)::integer AS none,
         COUNT(*) FILTER (WHERE dependents=1)::integer AS one,
         COUNT(*) FILTER (WHERE dependents>=2)::integer AS two_or_more
       FROM approved_counts`,
      values
    );

    const report: UsageReport = {
      term, fromDate, toDate,
      generatedAt: new Date().toISOString(),
      timeZone: ZONE,
      totals: totalRows.rows[0],
      weekly: weeklyRows.rows,
      completedPickupTypes: pickupRows.rows[0],
      servedStudentsByCurrentDependents: householdRows.rows[0],
      needsReportingAvailable: false
    };
    await client.query("COMMIT");
    return report;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch (rollbackError) {
      console.error("Report snapshot rollback failed:", rollbackError);
    }
    throw error;
  } finally {
    client.release();
  }
}

function csvCell(input: string | number): string {
  const text = String(input);
  // Spreadsheet formula protection for user-defined term names and codes.
  const safe = /^\s*[=+\-@]/.test(text) ? "'" + text : text;
  return '"' + safe.replace(/"/g, '""') + '"';
}
function exportCsv(report: UsageReport): string {
  const rows: Array<Array<string | number>> = [
    ["section", "period", "metric", "value"],
    ["metadata", "", "term_code", report.term.code],
    ["metadata", "", "term_name", report.term.name],
    ["metadata", "", "from_date", report.fromDate],
    ["metadata", "", "to_date", report.toDate],
    ["metadata", "", "time_zone", report.timeZone],
    ["metadata", "", "generated_at", report.generatedAt],
    ["metadata", "", "date_basis", "scheduled_appointment_local_date"],
    ["summary", "", "distinct_students_served", report.totals.students_served],
    ["summary", "", "appointments_booked", report.totals.booked],
    ["summary", "", "appointments_completed", report.totals.completed],
    ["summary", "", "appointments_missed", report.totals.no_show],
    ["summary", "", "appointments_cancelled", report.totals.cancelled],
    ["summary", "", "appointments_total", report.totals.total],
    ["summary", "", "overdue_booked_awaiting_outcome", report.totals.awaiting_outcome]
  ];
  for (const week of report.weekly) {
    for (const metric of ["booked", "completed", "no_show", "cancelled", "total"] as const) {
      rows.push(["weekly", week.week_start, metric, week[metric]]);
    }
  }
  for (const metric of ["self", "dependent", "third_party"] as const) {
    rows.push(["completed_pickup_types", "", metric, report.completedPickupTypes[metric]]);
  }
  for (const metric of ["none", "one", "two_or_more"] as const) {
    rows.push(["served_current_confirmed_dependents", "",
      metric, report.servedStudentsByCurrentDependents[metric]]);
  }
  rows.push(["data_availability", "", "needs_breakdown",
    "Not collected by the demonstration eligibility survey"]);
  rows.push(["data_availability", "", "household_indicator",
    "Current confirmed dependents, not a historic snapshot"]);
  // UTF-8 BOM improves spreadsheet compatibility; all records are aggregate.
  return "\uFEFF" + rows.map(row => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

function reportRequest(req: express.Request): {
  termId: string; fromDate: string | undefined; toDate: string | undefined;
} {
  const { termId, fromDate, toDate } = req.query;
  if (typeof termId !== "string" ||
      (termId !== "all" && !UUID.test(termId)) ||
      (fromDate !== undefined && !validDate(fromDate)) ||
      (toDate !== undefined && !validDate(toDate)) ||
      ((fromDate === undefined) !== (toDate === undefined)) ||
      (typeof fromDate === "string" && typeof toDate === "string" &&
        fromDate > toDate)) {
    throw new ReportError(400,
      "Provide a valid termId and either both dates (YYYY-MM-DD) or neither");
  }
  return {
    termId, fromDate: fromDate as string | undefined,
    toDate: toDate as string | undefined
  };
}

staffReportsRouter.get("/terms", async (_req, res) => {
  try {
    const result = await pool.query<ReportTerm>(
      `SELECT id,code,name,
        to_char(starts_on,'YYYY-MM-DD') AS starts_on,
        to_char(ends_on,'YYYY-MM-DD') AS ends_on
       FROM terms ORDER BY starts_on DESC,code LIMIT 100`
    );
    res.json({ terms: result.rows });
  } catch (error) { errorResponse(res, error); }
});

staffReportsRouter.get("/usage", async (req, res) => {
  try {
    const x = reportRequest(req);
    res.json({ report: await buildUsageReport(x.termId, x.fromDate, x.toDate) });
  } catch (error) { errorResponse(res, error); }
});

staffReportsRouter.get("/usage.csv", async (req, res) => {
  try {
    const x = reportRequest(req);
    const report = await buildUsageReport(x.termId, x.fromDate, x.toDate);
    const code = report.term.code.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 32);
    const filename = "uvss-usage-" + code + "-" +
      report.fromDate + "-to-" + report.toDate + ".csv";
    res.set({
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="' + filename + '"',
      "X-Content-Type-Options": "nosniff"
    });
    res.send(exportCsv(report));
  } catch (error) { errorResponse(res, error); }
});
