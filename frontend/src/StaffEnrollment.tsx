import { useEffect, useState } from "react";

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
type EnrollmentStatus = Student["enrollment_status"];
const API = "http://localhost:3001";

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
  const [busyStudentId, setBusyStudentId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch(API + "/api/terms", { credentials: "include" });
        if (!response.ok) throw new Error(await getError(response));
        const data = await response.json() as { terms: Term[] };
        setTerms(data.terms);
        setTermId(data.terms[0]?.id ?? "");
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, []);

  async function load(term: string) {
    const response = await fetch(
      API + "/api/staff/enrollments?termId=" + encodeURIComponent(term),
      { credentials: "include" }
    );
    if (!response.ok) throw new Error(await getError(response));
    const data = await response.json() as { students: Student[] };
    setStudents(data.students);
  }

  useEffect(() => {
    if (!termId) return;
    let cancelled = false;
    const response = fetch(
      API + "/api/staff/enrollments?termId=" + encodeURIComponent(termId),
      { credentials: "include" }
    );
    void response.then(async res => {
      if (!res.ok) throw new Error(await getError(res));
      const data = await res.json() as { students: Student[] };
      if (!cancelled) setStudents(data.students);
    }).catch(e => {
      if (!cancelled) setError((e as Error).message);
    });
    return () => { cancelled = true; };
  }, [termId]);

  async function setStatus(studentId: string, status: EnrollmentStatus) {
    setBusyStudentId(studentId);
    setMessage("");
    setError("");
    try {
      const response = await fetch(
        API + "/api/staff/enrollments/" + studentId + "/" + termId,
        {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status })
        }
      );
      if (!response.ok) throw new Error(await getError(response));
      await load(termId);
      setMessage("Enrollment status updated and audited.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyStudentId(null);
    }
  }

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
          <select value={termId} onChange={e => {
            setTermId(e.target.value);
            setError("");
            setMessage("");
            setStudents([]);
          }}>
            {terms.map(term => (
              <option key={term.id} value={term.id}>{term.name} ({term.code})</option>
            ))}
          </select>
        </label>
      </div>
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
              } onClick={() => void setStatus(student.id, "verified")}>
                Verify
              </button>
              <button type="button" disabled={
                busyStudentId !== null || student.enrollment_status === "rejected"
              } onClick={() => void setStatus(student.id, "rejected")}>
                Reject
              </button>
              <button type="button" disabled={
                busyStudentId !== null || student.enrollment_status === "pending"
              } onClick={() => void setStatus(student.id, "pending")}>
                Reset to pending
              </button>
            </div>
          </li>
        ))}
      </ul>
      {termId && students.length === 0 && !error && <p>No student profiles found.</p>}
      {message && <p role="status" className="auth-notice">{message}</p>}
      {error && <p role="alert" className="auth-notice">{error}</p>}
    </section>
  );
}
