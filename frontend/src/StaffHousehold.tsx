import { useEffect, useState } from "react";
import type { FormEvent } from "react";

type Kind = "dependents" | "contacts";
type Status = "pending" | "confirmed" | "denied";
interface RecordItem {
  id: string;
  student_id: string;
  student_first_name: string;
  student_last_name: string;
  student_email: string;
  full_name: string;
  status: Status;
  relationship?: string;
  contact_method?: string;
  contact_value?: string;
  consent_version?: string;
  consent_text?: string;
  consent_given_at?: string;
}
interface Pagination {
  offset: number;
  limit: number;
  total: number;
  hasNext: boolean;
  hasPrevious: boolean;
}
const API = "http://localhost:3001";
const PAGE_SIZE = 25;

async function api<T>(
  url: string, options: RequestInit = {}
): Promise<T> {
  const result = await fetch(API + url, {
    credentials: "include", cache: "no-store", ...options
  });
  const data = await result.json() as T & { error?: string };
  if (!result.ok) throw new Error(data.error ?? "Request failed");
  return data;
}

export default function StaffHousehold() {
  const [kind, setKind] = useState<Kind>("dependents");
  const [status, setStatus] = useState("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [page, setPage] = useState<Pagination | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    let running = false;
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE), offset: String(offset), status, search
    });
    setLoading(true);
    setError("");

    const refresh = () => {
      if (controller.signal.aborted || document.hidden || running) return;
      running = true;
      void (async () => {
        try {
          const response = await api<{
            records: RecordItem[];
            pagination: Pagination;
          }>(
            "/api/staff/household/" + kind + "?" + params.toString(),
            { signal: controller.signal }
          );
          if (controller.signal.aborted) return;
          if (response.pagination.total > 0 && response.records.length === 0 && offset > 0) {
            setOffset(Math.floor((response.pagination.total - 1) / PAGE_SIZE) * PAGE_SIZE);
            return;
          }
          setRecords(response.records);
          setPage(response.pagination);
          setError("");
        } catch (e) {
          if (!controller.signal.aborted) setError((e as Error).message);
        } finally {
          running = false;
          if (!controller.signal.aborted) setLoading(false);
        }
      })();
    };
    refresh();
    const timer = window.setInterval(refresh, 5000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [kind, status, search, offset, refreshVersion]);

  function searchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOffset(0);
    setSearch(searchInput.trim());
  }

  async function approve(id: string, newStatus: Status) {
    setBusyId(id);
    setError("");
    setMessage("");
    try {
      const result = await api<{ affectedBookings: number }>(
        "/api/staff/household/" + kind + "/" + id + "/status",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: newStatus })
        }
      );
      setMessage(
        "Status updated and audited." +
        (result.affectedBookings
          ? " " + result.affectedBookings +
            " upcoming booking(s) reverted to student pickup."
          : "")
      );
      setRefreshVersion(version => version + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="auth-panel">
      <h2>Staff dependent and pickup verification</h2>
      <p className="auth-muted">
        Restricted records. Review fictional dependent requests and consent
        before confirming a pickup contact. Changes are audited.
      </p>
      <div className="auth-fields">
        <label>
          Record type
          <select value={kind} onChange={e => {
            setKind(e.target.value as Kind);
            setOffset(0); setMessage("");
          }}>
            <option value="dependents">Dependent requests</option>
            <option value="contacts">Third-party pickup contacts</option>
          </select>
        </label>
        <label>
          Approval status
          <select value={status} onChange={e => {
            setStatus(e.target.value);
            setOffset(0);
          }}>
            <option value="all">All active records</option>
            <option value="pending">Pending review</option>
            <option value="confirmed">Confirmed</option>
            <option value="denied">Denied</option>
          </select>
        </label>
      </div>

      <form className="staff-search-form" onSubmit={searchSubmit}>
        <label htmlFor="household-review-search">Search student or requested person's name</label>
        <div className="staff-search-row">
          <input type="search" id="household-review-search" value={searchInput}
            maxLength={100} onChange={e => setSearchInput(e.target.value)}
            placeholder="Student name or fictional email" />
          <button type="submit">Search</button>
          <button type="button" onClick={() => {
            setSearchInput(""); setSearch(""); setOffset(0);
          }}>Clear</button>
        </div>
      </form>

      {loading && <p role="status">Loading household review records...</p>}
      {error && <p className="auth-notice" role="alert">{error}</p>}
      {message && <p className="auth-notice" role="status">{message}</p>}
      {!loading && !error && page && (
        <>
          <p className="auth-muted">
            Showing {page.total ? page.offset + 1 : 0}–
            {page.offset + records.length} of {page.total} records
          </p>
          {records.length === 0 ? <p>No Records Found.</p> : (
            <ul className="auth-list">
              {records.map(record => (
                <li key={record.id}>
                  <strong>{record.full_name}</strong>
                  <p>
                    Student: {record.student_first_name} {record.student_last_name}
                    {" — "}{record.student_email}
                  </p>
                  {record.relationship && <p>Relationship: {record.relationship}</p>}
                  {record.contact_method &&
                    <p>Contact: {record.contact_method} — {record.contact_value}</p>}
                  {record.consent_given_at &&
                    <p>Consent given: {new Date(record.consent_given_at).toLocaleString()}
                      {" · "}Version: {record.consent_version}
                    </p>}
                  {record.consent_text &&
                    <details>
                      <summary>View recorded consent disclosure</summary>
                      <p>{record.consent_text}</p>
                    </details>}
                  <p>Status: <strong>{record.status}</strong></p>
                  <div className="auth-actions">
                    <button type="button" disabled={busyId !== null ||
                      record.status === "confirmed"}
                      onClick={() => void approve(record.id, "confirmed")}>Confirm</button>
                    <button type="button" disabled={busyId !== null ||
                      record.status === "denied"}
                      onClick={() => void approve(record.id, "denied")}>Deny</button>
                    <button type="button" disabled={busyId !== null ||
                      record.status === "pending"}
                      onClick={() => void approve(record.id, "pending")}>Reset pending</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <nav className="staff-pagination" aria-label="Household review pages">
            <button type="button" disabled={!page.hasPrevious || busyId !== null}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Previous</button>
            <span>Page {Math.floor(page.offset / PAGE_SIZE) + 1} of
              {" "}{Math.max(1, Math.ceil(page.total / PAGE_SIZE))}
            </span>
            <button type="button" disabled={!page.hasNext || busyId !== null}
              onClick={() => setOffset(offset + PAGE_SIZE)}>Next</button>
          </nav>
        </>
      )}
    </section>
  );
}
