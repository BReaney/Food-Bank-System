import { useEffect, useState } from "react";
import type { FormEvent } from "react";

interface Student {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: "student";
}
interface PageInfo {
  limit: number;
  offset: number;
  total: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

const PAGE_SIZE = 25;
const API = "http://localhost:3001";

export default function StaffDirectory() {
  const [students, setStudents] = useState<Student[]>([]);
  const [page, setPage] = useState<PageInfo | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    let running = false;
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      search, limit: String(PAGE_SIZE), offset: String(offset)
    });

    const refresh = () => {
      if (document.hidden || running || controller.signal.aborted) return;
      running = true;
      void (async () => {
        try {
          const response = await fetch(
            API + "/api/staff/profiles?" + params.toString(),
            { credentials: "include", cache: "no-store", signal: controller.signal }
          );
          if (!response.ok) {
            const data = await response.json() as { error?: string };
            throw new Error(data.error || "Unable to load the student directory");
          }
          const data = await response.json() as {
            students: Student[]; pagination: PageInfo
          };
          if (controller.signal.aborted) return;
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
  }, [search, offset]);

  function applySearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOffset(0);
    setSearch(searchInput.trim());
  }

  function clearSearch() {
    setSearchInput("");
    setSearch("");
    setOffset(0);
  }

  return (
    <section className="auth-panel" aria-labelledby="staff-directory-title">
      <h2 id="staff-directory-title">Staff-only student directory</h2>
      <p className="auth-muted">
        Students cannot access this directory. It includes only fictional test profiles.
      </p>
      <form className="staff-search-form" onSubmit={applySearch}>
        <label htmlFor="directory-search">Search students by name or email</label>
        <div className="staff-search-row">
          <input
            id="directory-search" type="search" maxLength={100}
            placeholder="Search the full student directory"
            value={searchInput}
            onChange={event => setSearchInput(event.target.value)}
          />
          <button type="submit">Search</button>
          <button type="button" onClick={clearSearch}>Clear</button>
        </div>
      </form>

      {loading ? (
        <p role="status">Loading student directory...</p>
      ) : !error && page ? (
        <>
          <p role="status" className="auth-muted">
            Showing {page.total > 0 ? page.offset + 1 : 0}–{page.offset + students.length} of {page.total} students
            {search ? " matching '" + search + "'" : ""}.
          </p>
          {students.length === 0 ? (
            <p>No students found for this search.</p>
          ) : (
            <ul className="auth-list">
              {students.map(student => (
                <li key={student.id}>
                  {student.first_name} {student.last_name} — {student.email}
                </li>
              ))}
            </ul>
          )}
          <nav className="staff-pagination" aria-label="Student directory pages">
            <button type="button" disabled={!page.hasPrevious}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Previous</button>
            <span>
              Page {Math.floor(page.offset / PAGE_SIZE) + 1} of {Math.max(1, Math.ceil(page.total / PAGE_SIZE))}
            </span>
            <button type="button" disabled={!page.hasNext}
              onClick={() => setOffset(offset + PAGE_SIZE)}>Next</button>
          </nav>
        </>
      ) : null}
      {error && <p role="alert" className="auth-notice">{error}</p>}
    </section>
  );
}
