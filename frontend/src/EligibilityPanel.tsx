import { useEffect, useState } from "react";
import type { FormEvent, Dispatch, SetStateAction } from "react";
import { api } from "./api.js";

export interface TermEligibility {
  id: string;
  code: string;
  name: string;
  starts_on: string;
  ends_on: string;
  enrollment_status: "pending" | "verified" | "rejected";
  survey_submitted: boolean;
  survey_submitted_at: string | null;
}

interface Props {
  onTermsChange: Dispatch<SetStateAction<TermEligibility[]>>;
}

export function EligibilityPanel({ onTermsChange }: Props) {
  const [terms, setTerms] = useState<TermEligibility[]>([]);
  const [selectedTerm, setSelectedTerm] = useState("");
  const [householdType, setHouseholdType] = useState("");
  const [enrollmentAttestation, setEnrollmentAttestation] = useState(false);
  const [fictionalDataConfirmation, setFictionalDataConfirmation] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  async function reloadTerms() {
    const result = await api<{ terms: TermEligibility[] }>("/api/terms");
    setTerms(result.terms);
    onTermsChange(result.terms);
    setSelectedTerm(previous =>
      result.terms.some(term => term.id === previous)
        ? previous
        : (result.terms[0]?.id ?? "")
    );
  }

  useEffect(() => {
    let cancelled = false;
    api<{ terms: TermEligibility[] }>("/api/terms")
      .then(result => {
        if (cancelled) return;
        setTerms(result.terms);
        onTermsChange(result.terms);
        setSelectedTerm(result.terms[0]?.id ?? "");
      })
      .catch(error => {
        if (!cancelled) setNotice((error as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [onTermsChange]);

  const chosen = terms.find(term => term.id === selectedTerm);

  async function submitSurvey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!chosen || saving || chosen.survey_submitted) return;
    setSaving(true);
    setNotice("");
    try {
      const result = await api<{ message: string }>(
        "/api/terms/" + chosen.id + "/survey",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            enrollmentAttestation,
            householdType,
            fictionalDataConfirmation
          })
        }
      );
      setNotice(result.message);
      await reloadTerms();
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="auth-panel">
      <h2>Term eligibility and survey</h2>
      <p>Each term has a separate survey and staff enrollment decision.
        No real student details or identification documents should be submitted.</p>
      {loading ? <p>Loading terms...</p> : terms.length === 0 ? (
        <p>No current or upcoming terms are available.</p>
      ) : (
        <>
          <div className="auth-fields" style={{ marginTop: "12px" }}>
            <label>
              Select term
              <select value={selectedTerm} onChange={event => setSelectedTerm(event.target.value)}>
                {terms.map(term => (
                  <option value={term.id} key={term.id}>
                    {term.name} ({term.code})
                  </option>
                ))}
              </select>
            </label>
          </div>
          {chosen && (
            <>
              <p style={{ marginTop: "12px" }}>
                <strong>Survey:</strong> {chosen.survey_submitted ? "Submitted" : "Not submitted"}
              </p>
              <p>
                <strong>Staff enrollment review:</strong> {chosen.enrollment_status}
              </p>
              <p>
                <strong>Booking eligibility:</strong>{" "}
                {chosen.survey_submitted && chosen.enrollment_status === "verified"
                  ? "Requirements completed"
                  : "Not yet eligible"}
              </p>

              {!chosen.survey_submitted && (
                <form className="auth-fields" onSubmit={event => void submitSurvey(event)}
                  style={{ marginTop: "14px" }}>
                  <p><strong>Fictional prototype survey</strong></p>
                  <label>
                    Fictional household category
                    <select required value={householdType}
                      onChange={event => setHouseholdType(event.target.value)}>
                      <option value="">Choose an option</option>
                      <option value="individual">Individual</option>
                      <option value="with_dependents">Household with dependents</option>
                      <option value="prefer_not_to_say">Prefer not to say</option>
                    </select>
                  </label>
                  <label className="auth-check">
                    <input type="checkbox" required checked={enrollmentAttestation}
                      onChange={event => setEnrollmentAttestation(event.target.checked)}/>
                    <span>I affirm that this fictional student is enrolled for this term
                      (staff must verify independently).</span>
                  </label>
                  <label className="auth-check">
                    <input type="checkbox" required checked={fictionalDataConfirmation}
                      onChange={event => setFictionalDataConfirmation(event.target.checked)}/>
                    <span>I confirm this submission uses fictional information only.</span>
                  </label>
                  <button type="submit" disabled={saving}>
                    {saving ? "Submitting..." : "Submit term survey"}
                  </button>
                </form>
              )}
            </>
          )}
        </>
      )}
      {notice && <p className="auth-notice" role="status">{notice}</p>}
    </section>
  );
}
