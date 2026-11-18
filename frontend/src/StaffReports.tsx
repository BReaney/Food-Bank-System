import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { todayVancouver } from "./calendarDates";

const API = "http://localhost:3001";

interface Term {
  id: string;
  code: string;
  name: string;
  starts_on: string;
  ends_on: string;
}
interface Counts {
  total: number;
  booked: number;
  completed: number;
  no_show: number;
  cancelled: number;
  students_served: number;
  awaiting_outcome: number;
}
interface Week {
  week_start: string;
  booked: number;
  completed: number;
  no_show: number;
  cancelled: number;
  total: number;
}
interface UsageReport {
  term: Term;
  fromDate: string;
  toDate: string;
  generatedAt: string;
  timeZone: string;
  totals: Counts;
  weekly: Week[];
  completedPickupTypes: {
    self: number;
    dependent: number;
    third_party: number;
  };
  servedStudentsByCurrentDependents: {
    none: number;
    one: number;
    two_or_more: number;
  };
  needsReportingAvailable: false;
}
interface Applied {
  termId: string;
  fromDate: string;
  toDate: string;
}
const STATUSES = [
  { key: "booked", label: "Booked", className: "report-booked" },
  { key: "completed", label: "Completed", className: "report-completed" },
  { key: "no_show", label: "Missed", className: "report-missed" },
  { key: "cancelled", label: "Cancelled", className: "report-cancelled" }
] as const;

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(API + path, {
    credentials: "include", cache: "no-store", signal
  });
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "Unable to load usage report");
  return data;
}
function queryFor(applied: Applied): string {
  return new URLSearchParams({
    termId: applied.termId,
    fromDate: applied.fromDate,
    toDate: applied.toDate
  }).toString();
}
function calendarYear(): { from: string; to: string } {
  const year = todayVancouver().slice(0, 4);
  return { from: year + "-01-01", to: year + "-12-31" };
}
function weekLabel(weekStart: string): string {
  return new Date(weekStart + "T12:00:00Z").toLocaleDateString("en-CA", {
    timeZone: "UTC", month: "short", day: "numeric", year: "numeric"
  });
}
function metricLabel(metric: typeof STATUSES[number]["key"]) {
  return STATUSES.find(item => item.key === metric)?.label ?? metric;
}

export default function StaffReports() {
  const [terms, setTerms] = useState<Term[]>([]);
  const [termId, setTermId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [report, setReport] = useState<UsageReport | null>(null);
  const [applied, setApplied] = useState<Applied | null>(null);
  const [loadingTerms, setLoadingTerms] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [exportError, setExportError] = useState("");
  const requestRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void getJson<{ terms: Term[] }>("/api/staff/reports/terms", controller.signal)
      .then(data => {
        if (controller.signal.aborted) return;
        setTerms(data.terms);
        if (data.terms.length) {
          setTermId(data.terms[0].id);
          setFromDate(data.terms[0].starts_on);
          setToDate(data.terms[0].ends_on);
        }
      })
      .catch(e => {
        if (!controller.signal.aborted) setError((e as Error).message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingTerms(false);
      });
    return () => {
      controller.abort();
      requestRef.current?.abort();
    };
  }, []);

  function chooseTerm(next: string) {
    requestRef.current?.abort();
    setTermId(next);
    setReport(null); setApplied(null); setError(""); setExportError("");
    if (next === "all") {
      const year = calendarYear();
      setFromDate(year.from); setToDate(year.to);
    } else {
      const term = terms.find(item => item.id === next);
      setFromDate(term?.starts_on ?? "");
      setToDate(term?.ends_on ?? "");
    }
  }
  function changeFrom(next: string) {
    requestRef.current?.abort();
    setFromDate(next);
    setReport(null); setApplied(null); setError(""); setExportError("");
  }
  function changeTo(next: string) {
    requestRef.current?.abort();
    setToDate(next);
    setReport(null); setApplied(null); setError(""); setExportError("");
  }

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!termId || !fromDate || !toDate) {
      setError("Select a term and both dates");
      return;
    }
    if (fromDate > toDate) {
      setError("Start date must not be later than end date");
      return;
    }
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setGenerating(true); setError(""); setExportError("");
    setReport(null); setApplied(null);
    const params: Applied = { termId, fromDate, toDate };
    try {
      const result = await getJson<{ report: UsageReport }>(
        "/api/staff/reports/usage?" + queryFor(params),
        controller.signal
      );
      if (controller.signal.aborted) return;
      setReport(result.report);
      setApplied(params);
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message);
    } finally {
      if (!controller.signal.aborted) setGenerating(false);
    }
  }

  async function downloadCsv() {
    if (!applied || !report || exporting) return;
    setExporting(true); setExportError("");
    try {
      const result = await fetch(
        API + "/api/staff/reports/usage.csv?" + queryFor(applied),
        { credentials: "include", cache: "no-store" }
      );
      if (!result.ok) {
        const data = await result.json() as { error?: string };
        throw new Error(data.error ?? "Unable to export usage report");
      }
      const blob = await result.blob();
      const url = URL.createObjectURL(blob);
      const safeCode = report.term.code.replace(/[^A-Za-z0-9_-]/g, "_");
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download =
        "uvss-usage-" + safeCode + "-" + applied.fromDate + "-to-" +
        applied.toDate + ".csv";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setExportError((e as Error).message);
    } finally {
      setExporting(false);
    }
  }

  const selectedTerm = terms.find(item => item.id === termId);
  const maxWeekCount = report?.weekly.reduce(
    (maximum, week) => Math.max(maximum, week.total), 0
  ) ?? 0;
  const totals = report?.totals;

  return (
    <section className="auth-panel" aria-labelledby="staff-reports-title">
      <h2 id="staff-reports-title">System usage reporting</h2>
      <p className="auth-muted">
        Staff-only aggregate reporting for fictional test data. Counts are
        based on the scheduled appointment's Vancouver-local date.
        No student names, email addresses, or private contacts are exported.
      </p>

      <form onSubmit={e => void generate(e)} className="auth-fields">
        <label htmlFor="report-term">Term or reporting period
          <select id="report-term" value={termId} disabled={loadingTerms || generating}
            onChange={e => chooseTerm(e.target.value)} required>
            <option value="">Select term</option>
            {terms.map(term => (
              <option key={term.id} value={term.id}>
                {term.name} ({term.code})
              </option>
            ))}
            {terms.length > 0 && <option value="all">
              All terms (custom date range, up to one year)
            </option>}
          </select>
        </label>
        <div className="report-filters">
          <label htmlFor="report-from">Start date
            <input id="report-from" type="date" required
              value={fromDate} disabled={!termId || generating}
              min={selectedTerm?.starts_on} max={selectedTerm?.ends_on}
              onChange={e => changeFrom(e.target.value)}/>
          </label>
          <label htmlFor="report-to">End date (inclusive)
            <input id="report-to" type="date" required
              value={toDate} disabled={!termId || generating}
              min={selectedTerm?.starts_on} max={selectedTerm?.ends_on}
              onChange={e => changeTo(e.target.value)}/>
          </label>
        </div>
        <div className="auth-actions">
          <button type="submit"
            disabled={loadingTerms || !termId || generating}>
            {generating ? "Generating report..." : "Generate usage report"}
          </button>
          <button type="button"
            onClick={() => void downloadCsv()}
            disabled={!report || !applied || generating || exporting}>
            {exporting ? "Exporting..." : "Export report as CSV"}
          </button>
        </div>
      </form>

      {loadingTerms && <p role="status">Loading reporting terms...</p>}
      {!loadingTerms && terms.length === 0 && !error &&
        <p>No terms are configured. Staff can create one in the calendar section.</p>}
      {error && <p role="alert" className="auth-notice">{error}</p>}
      {exportError && <p role="alert" className="auth-notice">{exportError}</p>}

      {report && totals && (
        <div className="staff-report-result">
          <div className="report-heading">
            <div>
              <h3>{report.term.name} — usage report</h3>
              <p className="auth-muted">
                {report.fromDate} to {report.toDate} (inclusive) ·
                Generated {new Date(report.generatedAt).toLocaleString("en-CA",
                  { timeZone: "America/Vancouver" })} Vancouver time
              </p>
            </div>
          </div>

          <div className="report-metrics" aria-label="Term usage totals">
            {[
              { label: "Students served", value: totals.students_served },
              { label: "Booked", value: totals.booked },
              { label: "Completed", value: totals.completed },
              { label: "Missed (no-show)", value: totals.no_show },
              { label: "Cancelled", value: totals.cancelled },
              { label: "Total booking records", value: totals.total }
            ].map(metric => (
              <div key={metric.label} className="report-metric">
                <span className="report-metric-number">{metric.value}</span>
                <span>{metric.label}</span>
              </div>
            ))}
          </div>
          <p className="auth-muted">
            <strong>Students served</strong> counts distinct students with at
            least one completed appointment in this reporting period.
            A student with two completed pickups counts once as served,
            but twice in completed appointments.
          </p>
          {totals.awaiting_outcome > 0 && (
            <p role="status" className="auth-notice">
              {totals.awaiting_outcome} booked appointment(s) have already
              ended and are awaiting staff outcome review. They are still
              counted as Booked until marked Completed or No-show.
            </p>
          )}

          <h3>Weekly appointment trends</h3>
          <p className="auth-muted">
            Each stacked bar represents the appointment statuses for one
            Vancouver-local Monday–Sunday week. The first and last weeks
            may include only part of that week.
          </p>
          <div className="report-legend" aria-label="Trend legend">
            {STATUSES.map(status => (
              <span key={status.key}>
                <span className={"report-legend-swatch " + status.className}/>
                {status.label}
              </span>
            ))}
          </div>
          <div className="report-trend-list" role="img"
            aria-label="Weekly status counts. An accessible data table follows.">
            {report.weekly.map(week => (
              <div className="report-trend-row" key={week.week_start}>
                <span className="report-trend-label">{weekLabel(week.week_start)}</span>
                <div className="report-trend-track"
                  title={week.total + " appointments in the week of " +
                    weekLabel(week.week_start)}>
                  {STATUSES.map(status => (
                    <span key={status.key} className={status.className}
                      style={{
                        width: maxWeekCount
                          ? (100 * week[status.key] / maxWeekCount) + "%"
                          : "0%"
                      }}/>
                  ))}
                </div>
                <span className="report-trend-total">{week.total}</span>
              </div>
            ))}
          </div>
          <details className="report-data-details">
            <summary>View weekly data table</summary>
            <div className="report-table-scroll">
              <table className="report-table">
                <caption>Appointments grouped by Vancouver-local week</caption>
                <thead><tr>
                  <th scope="col">Week of</th>
                  {STATUSES.map(s => (
                    <th scope="col" key={s.key}>{metricLabel(s.key)}</th>
                  ))}
                  <th scope="col">Total</th>
                </tr></thead>
                <tbody>{report.weekly.map(week => (
                  <tr key={week.week_start}>
                    <th scope="row">{week.week_start}</th>
                    {STATUSES.map(status => (
                      <td key={status.key}>{week[status.key]}</td>
                    ))}
                    <td>{week.total}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </details>
          {totals.total === 0 && (
            <p role="status">No appointment records were found in this date range.</p>
          )}

          <div className="report-breakdowns">
            <section aria-labelledby="pickup-breakdown-title">
              <h3 id="pickup-breakdown-title">Completed pickup designations</h3>
              <p className="auth-muted">
                Counts of completed appointments by designated pickup person.
              </p>
              <dl className="report-values">
                <div><dt>Student pickup</dt><dd>{report.completedPickupTypes.self}</dd></div>
                <div><dt>Dependent</dt><dd>{report.completedPickupTypes.dependent}</dd></div>
                <div><dt>Approved third party</dt>
                  <dd>{report.completedPickupTypes.third_party}</dd></div>
              </dl>
            </section>
            <section aria-labelledby="household-breakdown-title">
              <h3 id="household-breakdown-title">Students served, by approved dependents</h3>
              <p className="auth-muted">
                Distinct served students grouped by their <strong>current</strong>
                number of confirmed, active dependents. This is not a
                historical household snapshot.
              </p>
              <dl className="report-values">
                <div><dt>No confirmed dependents</dt>
                  <dd>{report.servedStudentsByCurrentDependents.none}</dd></div>
                <div><dt>One confirmed dependent</dt>
                  <dd>{report.servedStudentsByCurrentDependents.one}</dd></div>
                <div><dt>Two or more confirmed dependents</dt>
                  <dd>{report.servedStudentsByCurrentDependents.two_or_more}</dd></div>
              </dl>
            </section>
          </div>

          <h3>Needs reporting</h3>
          <p className="auth-muted">
            Not available in this prototype. Our fictional eligibility survey
            does not ask approved questions about food needs or household
            circumstances, so the system cannot provide a valid needs
            breakdown. We will not invent or infer sensitive answers.
          </p>
          <p className="auth-muted">
            CSV contains the same aggregate metrics and weekly data, with
            no names, emails, contact details or raw survey responses.
            Changes recorded after generation will appear in a newly
            generated report.
          </p>
        </div>
      )}
    </section>
  );
}
