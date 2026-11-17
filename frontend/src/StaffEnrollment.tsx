import { useEffect, useState } from "react";
import type { FormEvent } from "react";

interface Term {
  id: string;
  code: string;
  name: string;
  starts_on: string;
  ends_on: string;
}
interface Student {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  enrollment_status: "pending" | "verified" | "rejected";
  survey_submitted_at: string | null;
}
interface Pagination {
  limit: number;
  offset: number;
  total: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

type EnrollmentStatus = Student["enrollment_status"];
const API = "http://localhost:3001";
const PAGE_SIZE = 25;

async function getError(response: Response): Promise<string> {
  const data: unknown = await response.json();
  if (data && typeof data === "object" && "error" in data &&
      typeof data.error === "string") return data.error;
  return "Request failed";
}

export default function StaffEnrollment() {
  const [terms, setTerms] = useState<Term[]>([]);
  const [termId, setTermId] = useState("");
  const [students, setStudents] = useState<Student[]>([]);
  const [page, setPage] = useState<Pagination | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busyStudentId, setBusyStudentId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(API + "/api/terms", {
          credentials: "include",
          signal: controller.signal
        });
        if (!response.ok) throw new Error(await getError(response));
        const data = await response.json() as { terms: Term[] };
        if (!controller.signal.aborted) {
          setTerms(data.terms);
          setTermId(data.terms[0]?.id ?? "");
          if (data.terms.length === 0) setLoading(false);
        }
      } catch (e) {
        if (!controller.signal.aborted) {
          setError((e as Error).message);
          setLoading(false);
        }
      }
    })();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!termId) return;
    const controller = new AbortController();
    const params = new URLSearchParams({
      termId,
      search: appliedSearch,
      limit: String(PAGE_SIZE),
      offset: String(offset)
    });
    setLoading(true);
    setError("");

    void (async () => {
      try {
        const response = await fetch(
          API + "/api/staff/enrollments?" + params.toString(),
          { credentials: "include", signal: controller.signal }
        );
        if (!response.ok) throw new Error(await getError(response));
        const data = await response.json() as {
          students: Student[];
          pagination: Pagination;
        };
        if (controller.signal.aborted) return;

        // A deleted student might leave the final page empty.
        // Navigate to the last valid page instead of getting stuck.
        if (data.pagination.total > 0 && data.students.length === 0 && offset > 0) {
          setOffset(Math.floor((data.pagination.total - 1) / PAGE_SIZE) * PAGE_SIZE);
          return;
        }
        setStudents(data.students);
        setPage(data.pagination);
      } catch (e) {
        if (!controller.signal.aborted) {
          setError((e as Error).message);
          setStudents([]);
          setPage(null);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [termId, appliedSearch, offset, refreshVersion]);

  function applySearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOffset(0);
    setAppliedSearch(searchInput.trim());
    setMessage("");
  }

  function clearSearch() {
    setSearchInput("");
    setAppliedSearch("");
    setOffset(0);
    setMessage("");
  }

  async function setStatus(studentId: string, status: EnrollmentStatus) {
    const selectedTermId = termId;
    setBusyStudentId(studentId);
    setMessage("");
    setError("");
    try {
      const response = await fetch(
        API + "/api/staff/enrollments/" + studentId + "/" + selectedTermId,
        {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status })
        }
      );
      if (!response.ok) throw new Error(await getError(response));
      // Refresh the current page after updating a student's approval.
      setRefreshVersion(value => value + 1);
      setMessage("Enrollment status updated and audited.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyStudentId(null);
    }
  }

  const showingFrom = page && page.total > 0 ? page.offset + 1 : 0;
  const showingTo = page ? page.offset + students.length : 0;

  return (
    <section className="auth-panel" aria-labelledby="staff-enrollment-title">
      <h2 id="staff-enrollment-title">Enrollment verification (staff)</h2>
      <p className="auth-muted">
        Verify enrollment only after checking independent, fictional test evidence.
        A survey submission alone is not proof of enrollment.
      </p>

      <div className="auth-fields">
        <label>
          Term
          <select value={termId} onChange={event => {
            setTermId(event.target.value);
            setOffset(0);
            setSearchInput("");
            setAppliedSearch("");
            setStudents([]);
            setPage(null);
            setMessage("");
            setError("");
          }}>
            {terms.map(term => (
              <option key={term.id} value={term.id}>
                {term.name} ({term.code})
              </option>
            ))}
          </select>
        </label>
      </div>

      {termId && (
        <form className="staff-search-form" onSubmit={applySearch}>
          <label htmlFor="enrollment-search">Search students by name or email</label>
          <div className="staff-search-row">
            <input
              id="enrollment-search"
              type="search"
              maxLength={100}
              value={searchInput}
              placeholder="e.g. Taylor or example.test"
              onChange={event => setSearchInput(event.target.value)}
            />
            <button type="submit">Search</button>
            <button type="button" onClick={clearSearch}>Clear</button>
          </div>
        </form>
      )}

      {loading ? (
        <p role="status">Loading student enrollment records...</p>
      ) : !error && page ? (
        <>
          <p role="status" className="auth-muted">
            Showing {showingFrom}–{showingTo} of {page.total} students
            {appliedSearch ? " matching '" + appliedSearch + "'" : ""}.
          </p>
          {students.length === 0 ? (
            <p>No students found for this search.</p>
          ) : (
            <ul className="auth-list">
              {students.map(student => (
                <li key={student.id}>
                  <strong>{student.first_name} {student.last_name}</strong>
                  <p>{student.email}</p>
                  <p>Enrollment: <strong>{student.enrollment_status}</strong></p>
                  <p>Survey: {student.survey_submitted_at ? "submitted" : "not submitted"}</p>
                  <div className="auth-actions">
                    <button type="button" disabled={
                      busyStudentId !== null || student.enrollment_status === "verified"
                    } onClick={() => void setStatus(student.id, "verified")}>Verify</button>
                    <button type="button" disabled={
                      busyStudentId !== null || student.enrollment_status === "rejected"
                    } onClick={() => void setStatus(student.id, "rejected")}>Reject</button>
                    <button type="button" disabled={
                      busyStudentId !== null || student.enrollment_status === "pending"
                    } onClick={() => void setStatus(student.id, "pending")}>
                      Reset to pending
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <nav className="staff-pagination" aria-label="Enrollment roster pages">
            <button
              type="button"
              disabled={!page.hasPrevious || loading || busyStudentId !== null}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >Previous</button>
            <span>Page {Math.floor(page.offset / PAGE_SIZE) + 1} of {Math.max(1, Math.ceil(page.total / PAGE_SIZE))}</span>
            <button
              type="button"
              disabled={!page.hasNext || loading || busyStudentId !== null}
              onClick={() => setOffset(offset + PAGE_SIZE)}
            >Next</button>
          </nav>
        </>
      ) : !termId && terms.length === 0 && !error ? (
        <p>No terms configured.</p>
      ) : null}
      {message && <p role="status" className="auth-notice">{message}</p>}
      {error && <p role="alert" className="auth-notice">{error}</p>}
    </section>
  );
}
