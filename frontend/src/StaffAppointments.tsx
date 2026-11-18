import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

interface Term { id: string; code: string; name: string; }
interface Booking {
  id: string;
  student_id: string;
  email: string;
  first_name: string;
  last_name: string;
  status: string;
  starts_at: string;
  ends_at: string;
  booked_at: string;
  term_code: string;
  term_name: string;
  pickup_kind: "self" | "dependent" | "third_party";
  pickup_name: string | null;
  pickup_status: string | null;
  pickup_consent_at: string | null;
}
interface Pagination {
  limit: number; offset: number; total: number;
  hasNext: boolean; hasPrevious: boolean;
}

const API = "http://localhost:3001";
const PAGE_SIZE = 25;
type RosterStatus = "needs_review" | "booked" | "completed" |
  "no_show" | "cancelled" | "all";

function dateLabel(value: string): string {
  return new Date(value).toLocaleString("en-CA", {
    timeZone: "America/Vancouver",
    dateStyle: "medium",
    timeStyle: "short"
  });
}

export default function StaffAppointments() {
  const [terms, setTerms] = useState<Term[]>([]);
  const [termId, setTermId] = useState("");
  const [status, setStatus] = useState<RosterStatus>("needs_review");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [success, setSuccess] = useState("");
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const requestId = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(API + "/api/terms", {
      credentials: "include", cache: "no-store", signal: controller.signal
    }).then(async response => {
      if (!response.ok) throw new Error("Unable to retrieve terms");
      const data = await response.json() as { terms: Term[] };
      if (!controller.signal.aborted) setTerms(data.terms);
    }).catch(e => {
      if (!controller.signal.aborted) setError((e as Error).message);
    });
    return () => controller.abort();
  }, []);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const id = ++requestId.current;
    const params = new URLSearchParams({
      search,
      limit: String(PAGE_SIZE),
      offset: String(offset),
      status
    });
    if (termId) params.set("termId", termId);

    try {
      const response = await fetch(
        API + "/api/staff/bookings?" + params.toString(),
        { credentials: "include", cache: "no-store", signal }
      );
      const data: unknown = await response.json();
      if (!response.ok) {
        const errorText = data && typeof data === "object" &&
          "error" in data && typeof data.error === "string"
          ? data.error : "Unable to load staff appointments";
        throw new Error(errorText);
      }
      const result = data as { bookings: Booking[]; pagination: Pagination };
      if (signal?.aborted || id !== requestId.current) return;

      if (result.pagination.total > 0 && result.bookings.length === 0 && offset > 0) {
        setOffset(Math.floor((result.pagination.total - 1) / PAGE_SIZE) * PAGE_SIZE);
        return;
      }
      setBookings(result.bookings);
      setPagination(result.pagination);
      setError("");
    } catch (e) {
      if (!signal?.aborted && id === requestId.current) setError((e as Error).message);
    } finally {
      if (!signal?.aborted && id === requestId.current) setLoading(false);
    }
  }, [termId, search, offset, status]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void refresh(controller.signal);
    const onRefresh = () => {
      if (!document.hidden) void refresh(controller.signal);
    };
    const interval = window.setInterval(onRefresh, 5000);
    window.addEventListener("focus", onRefresh);
    document.addEventListener("visibilitychange", onRefresh);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      window.removeEventListener("focus", onRefresh);
      document.removeEventListener("visibilitychange", onRefresh);
    };
  }, [refresh]);

  async function recordOutcome(booking: Booking, outcome: "completed" | "no_show") {
    const title = outcome === "completed" ? "Completed" : "No-show";
    if (!window.confirm(
      "Mark " + booking.first_name + " " + booking.last_name +
      "'s appointment on " + dateLabel(booking.starts_at) +
      " as " + title + "? This is a final audit-recorded status."
    )) return;

    setMarkingId(booking.id);
    setActionError("");
    setSuccess("");
    try {
      const response = await fetch(
        API + "/api/staff/bookings/" + booking.id + "/outcome",
        {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ outcome })
        }
      );
      const result = await response.json() as { message?: string; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Unable to record outcome");
      setSuccess(result.message ?? "Appointment outcome recorded");
      await refresh();
    } catch (e) {
      setActionError((e as Error).message);
      await refresh();
    } finally {
      setMarkingId(null);
    }
  }

  function applySearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOffset(0);
    setSearch(searchInput.trim());
  }

  return (
    <section className="auth-panel">
      <h2>Staff appointment roster</h2>
      <p className="auth-muted">
        Staff-only view with student names and appointment details. Updates every five
        seconds and when the page regains focus. Other students do not receive this data.
        Once an appointment has ended, staff can mark it completed or no-show;
        the action is recorded in its history and cannot be undone in this prototype.
      </p>
      <div className="auth-fields">
        <label>
          Term
          <select value={termId} onChange={event => {
            setTermId(event.target.value);
            setOffset(0);
          }}>
            <option value="">All terms</option>
            {terms.map(term => (
              <option key={term.id} value={term.id}>{term.name} ({term.code})</option>
            ))}
          </select>
        </label>
        <label>
          Show
          <select value={status} onChange={event => {
            setStatus(event.target.value as RosterStatus);
            setOffset(0);
            setSuccess("");
            setActionError("");
          }}>
            <option value="needs_review">Awaiting outcome (appointment ended)</option>
            <option value="booked">Upcoming active appointments</option>
            <option value="completed">Completed</option>
            <option value="no_show">No-shows</option>
            <option value="cancelled">Cancelled</option>
            <option value="all">All booking history</option>
          </select>
        </label>
      </div>

      <form className="staff-search-form" onSubmit={applySearch}>
        <label htmlFor="staff-appointments-search">Search by student name or email</label>
        <div className="staff-search-row">
          <input
            id="staff-appointments-search"
            type="search"
            value={searchInput}
            maxLength={100}
            onChange={event => setSearchInput(event.target.value)}
            placeholder="Search fictional students"
          />
          <button type="submit">Search</button>
          <button type="button" onClick={() => {
            setSearchInput(""); setSearch(""); setOffset(0);
          }}>Clear</button>
        </div>
      </form>

      {actionError && <p role="alert" className="auth-notice">{actionError}</p>}
      {success && <p role="status" className="auth-notice">{success}</p>}
      {error && <p role="alert" className="auth-notice">{error}</p>}
      {loading && <p role="status">Refreshing bookings...</p>}
      {!loading && pagination && !error && (
        <>
          <p className="auth-muted" role="status">
            Showing {pagination.total ? pagination.offset + 1 : 0}–
            {pagination.offset + bookings.length} of {pagination.total} appointments
          </p>
          {bookings.length ? (
            <ul className="auth-list">
              {bookings.map(booking => (
                <li key={booking.id}>
                  <strong>{booking.first_name} {booking.last_name}</strong>
                  <p>{booking.email}</p>
                  <p>{dateLabel(booking.starts_at)} — {booking.term_code}</p>
                  <p>Status: <strong>{booking.status === "no_show" ? "No-show" :
                    booking.status === "completed" ? "Completed" :
                    booking.status === "booked" && new Date(booking.ends_at).getTime() <= Date.now()
                      ? "Awaiting outcome" : booking.status}</strong></p>
                  {booking.status === "booked" &&
                    new Date(booking.ends_at).getTime() <= Date.now() && (
                      <div className="auth-actions">
                        <button type="button" disabled={markingId !== null}
                          onClick={() => void recordOutcome(booking, "completed")}>
                          Mark completed
                        </button>
                        <button type="button" disabled={markingId !== null}
                          onClick={() => void recordOutcome(booking, "no_show")}>
                          Mark no-show
                        </button>
                      </div>
                    )}
                  {booking.status === "booked" &&
                    new Date(booking.ends_at).getTime() > Date.now() &&
                    <p className="auth-muted">
                      Outcome recording becomes available after the appointment ends.
                    </p>}
                  <p>Pickup: <strong>{booking.pickup_kind === "self"
                    ? "Student collecting"
                    : booking.pickup_name ?? "Unknown"}</strong>
                    {booking.pickup_kind !== "self" &&
                      " (" + (booking.pickup_status ?? "unverified") + ")"}
                  </p>
                  {booking.pickup_kind === "third_party" && booking.pickup_consent_at &&
                    <p className="auth-muted">
                      Consent recorded: {dateLabel(booking.pickup_consent_at)}
                    </p>}
                </li>
              ))}
            </ul>
          ) : (
            <p>No appointment records found.</p>
          )}
          <nav className="staff-pagination" aria-label="Staff appointment pages">
            <button type="button" disabled={!pagination.hasPrevious}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
              Previous
            </button>
            <span>Page {Math.floor(pagination.offset / PAGE_SIZE) + 1} of
              {" "}{Math.max(1, Math.ceil(pagination.total / PAGE_SIZE))}
            </span>
            <button type="button" disabled={!pagination.hasNext}
              onClick={() => setOffset(offset + PAGE_SIZE)}>
              Next
            </button>
          </nav>
        </>
      )}
    </section>
  );
}
