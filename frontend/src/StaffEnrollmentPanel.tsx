import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api } from "./api.js";
import type { TermEligibility } from "./EligibilityPanel.js";

type Status = "pending" | "verified" | "rejected";
interface EnrollmentStudent {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  enrollment_status: Status;
  survey_submitted: boolean;
  survey_submitted_at: string | null;
  verified_at: string | null;
}

export function StaffEnrollmentPanel() {
  const [terms, setTerms] = useState<TermEligibility[]>([]);
  const [termId, setTermId] = useState("");
  const [searchText, setSearchText] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [students, setStudents] = useState<EnrollmentStudent[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    api<{ terms: TermEligibility[] }>("/api/terms")
      .then(result => {
        if (!active) return;
        setTerms(result.terms);
        setTermId(result.terms[0]?.id ?? "");
        if (!result.terms.length) setLoading(false);
      })
      .catch(error => {
        if (active) {
          setNotice((error as Error).message);
          setLoading(false);
        }
      });
    return () => { active = false; };
  }, []);

  async function reloadRoster(selected: string, query: string, pageOffset: number) {
    const params = new URLSearchParams({
      termId: selected,
      search: query,
      offset: String(pageOffset)
    });
    const result = await api<{
      students: EnrollmentStudent[];
      nextOffset: number | null;
    }>("/api/staff/enrollment?" + params.toString());
    setStudents(result.students);
    setNextOffset(result.nextOffset);
  }

  useEffect(() => {
    if (!termId) return;
    let active = true;
    setLoading(true);
    const params = new URLSearchParams({
      termId, search, offset: String(offset)
    });
    api<{ students: EnrollmentStudent[]; nextOffset: number | null }>(
      "/api/staff/enrollment?" + params.toString()
    )
      .then(result => {
        if (active) {
          setStudents(result.students);
          setNextOffset(result.nextOffset);
        }
      })
      .catch(error => {
        if (active) setNotice((error as Error).message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [termId, search, offset]);

  function performSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOffset(0);
    setSearch(searchText.trim());
    setNotice("");
  }

  async function changeStatus(studentId: string, status: Status) {
    if (savingId) return;
    setSavingId(studentId);
    setNotice("");
    try {
      await api("/api/staff/enrollment/" + studentId, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ termId, status })
      });
      await reloadRoster(termId, search, offset);
      setNotice("Enrollment status saved and added to the staff audit log.");
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setSavingId(null);
    }
  }

  return (
    <section className="auth-panel">
      <h2>Staff enrollment verification</h2>
      <p>Staff must confirm fictional enrollment independently of the student's survey.
        Changing an enrollment decision is recorded in the audit log.</p>

      {terms.length > 0 && (
        <>
          <div className="auth-fields" style={{ marginTop: "12px" }}>
            <label>
              Term to review
              <select value={termId} onChange={event => {
                setTermId(event.target.value);
                setOffset(0);
                setNotice("");
              }}>
                {terms.map(term => (
                  <option key={term.id} value={term.id}>
                    {term.name} ({term.code})
                  </option>
                ))}
              </select>
            </label>
            <form onSubmit={performSearch} className="auth-actions">
              <label style={{ flex: 1 }}>
                Search name or email
                <input maxLength={100} value={searchText}
                  onChange={event => setSearchText(event.target.value)}
                  placeholder="Fictional student name or email" />
              </label>
              <button type="submit">Search</button>
            </form>
          </div>

          {loading ? <p>Loading student roster...</p> : (
            <>
              {students.length === 0
                ? <p>No records found for this search.</p>
                : (
                  <ul className="auth-list">
                    {students.map(student => (
                      <li key={student.id}>
                        <strong>{student.first_name} {student.last_name}</strong>
                        <p>{student.email}</p>
                        <p><strong>Survey:</strong> {student.survey_submitted ? "Submitted" : "Missing"}</p>
                        <p><strong>Enrollment:</strong> {student.enrollment_status}</p>
                        <div className="auth-actions">
                          <button type="button" disabled={savingId !== null}
                            onClick={() => void changeStatus(student.id, "verified")}>
                            Verify
                          </button>
                          <button type="button" disabled={savingId !== null}
                            onClick={() => void changeStatus(student.id, "rejected")}>
                            Reject
                          </button>
                          <button type="button" disabled={savingId !== null}
                            onClick={() => void changeStatus(student.id, "pending")}>
                            Mark pending
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              <div className="auth-actions">
                <button type="button" disabled={offset === 0 || loading}
                  onClick={() => setOffset(Math.max(0, offset - 50))}>Previous</button>
                <button type="button" disabled={nextOffset === null || loading}
                  onClick={() => nextOffset !== null && setOffset(nextOffset)}>Next</button>
              </div>
            </>
          )}
        </>
      )}
      {!loading && terms.length === 0 && <p>No available terms were found.</p>}
      {notice && <p className="auth-notice" role="status">{notice}</p>}
    </section>
  );
}
