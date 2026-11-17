import { useEffect, useState } from "react";
import type { FormEvent } from "react";

interface StudentTerm {
  id: string;
  code: string;
  name: string;
  starts_on: string;
  ends_on: string;
  enrollment_status: "pending" | "verified" | "rejected";
  survey_submitted_at: string | null;
  enrollment_verified_at: string | null;
}

const API = "http://localhost:3001";

async function getError(response: Response): Promise<string> {
  const data: unknown = await response.json();
  if (data && typeof data === "object" && "error" in data &&
      typeof data.error === "string") return data.error;
  return "Request failed";
}

export default function StudentEligibility() {
  const [terms, setTerms] = useState<StudentTerm[]>([]);
  const [selectedTermId, setSelectedTermId] = useState("");
  const [confirmAccurate, setConfirmAccurate] = useState(false);
  const [understandVerification, setUnderstandVerification] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function load() {
    const response = await fetch(API + "/api/eligibility/terms", {
      credentials: "include"
    });
    if (!response.ok) throw new Error(await getError(response));
    const data = await response.json() as { terms: StudentTerm[] };
    setTerms(data.terms);
    setSelectedTermId(current => current || data.terms[0]?.id || "");
  }

  useEffect(() => {
    void load().catch(e => setError((e as Error).message));
  }, []);

  const selectedTerm = terms.find(term => term.id === selectedTermId);
  // Date strings are YYYY-MM-DD. Compare them with a Vancouver-local date.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Vancouver",
    year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date());
  const part = (type: string) =>
    parts.find(item => item.type === type)?.value ?? "";
  const today = part("year") + "-" + part("month") + "-" + part("day");
  const expired = selectedTerm ? selectedTerm.ends_on < today : false;
  const completed = Boolean(selectedTerm?.survey_submitted_at);
  const fullyEligible = completed && selectedTerm?.enrollment_status === "verified";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(API + "/api/eligibility/surveys/" + selectedTermId, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmAccurate, understandVerification })
      });
      if (!response.ok) throw new Error(await getError(response));
      setMessage("Survey saved. Staff enrollment verification is still required.");
      setConfirmAccurate(false);
      setUnderstandVerification(false);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="auth-panel" aria-labelledby="eligibility-title">
      <h2 id="eligibility-title">Enrollment and eligibility</h2>
      <p className="auth-muted">
        Confirmations apply separately to each term. The survey below is a
        non-sensitive demonstration, not the final UVSS questionnaire.
      </p>
      {terms.length === 0 ? (
        <p>No term calendar has been configured yet.</p>
      ) : (
        <>
          <div className="auth-fields">
            <label>
              Select term
              <select value={selectedTermId}
                onChange={e => { setSelectedTermId(e.target.value); setError(""); setMessage(""); }}>
                {terms.map(term => (
                  <option key={term.id} value={term.id}>
                    {term.name} ({term.code})
                  </option>
                ))}
              </select>
            </label>
          </div>
          {selectedTerm && (
            <>
              <p><strong>Term:</strong> {selectedTerm.starts_on} to {selectedTerm.ends_on}</p>
              <p><strong>Enrollment status:</strong> {selectedTerm.enrollment_status}</p>
              <p><strong>Survey:</strong> {completed ? "submitted" : "not submitted"}</p>
              <p><strong>Booking eligibility:</strong> {fullyEligible && !expired
                ? "Requirements met for this term"
                : "Requirements incomplete or term expired"}</p>
              {!completed && !expired && (
                <form className="auth-fields" onSubmit={e => void submit(e)}>
                  <fieldset className="eligibility-checks">
                    <legend>Demonstration eligibility confirmations</legend>
                    <label>
                      <input type="checkbox" checked={confirmAccurate}
                        onChange={e => setConfirmAccurate(e.target.checked)} required />
                      I confirm my demonstration information is accurate.
                    </label>
                    <label>
                      <input type="checkbox" checked={understandVerification}
                        onChange={e => setUnderstandVerification(e.target.checked)} required />
                      I understand staff must independently verify enrollment
                      before I can book an appointment.
                    </label>
                  </fieldset>
                  <button type="submit"
                    disabled={busy || !confirmAccurate || !understandVerification}>
                    {busy ? "Submitting..." : "Submit term survey"}
                  </button>
                </form>
              )}
              {expired && <p>This term has ended. New survey submissions are closed.</p>}
            </>
          )}
        </>
      )}
      {message && <p role="status" className="auth-notice">{message}</p>}
      {error && <p role="alert" className="auth-notice">{error}</p>}
    </section>
  );
}
