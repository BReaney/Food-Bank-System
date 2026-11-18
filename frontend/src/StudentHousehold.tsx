import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";

export interface Dependent {
  id: string;
  full_name: string;
  relationship: string;
  status: "pending" | "confirmed" | "denied";
}
export interface PickupContact {
  id: string;
  full_name: string;
  contact_method: "email" | "phone";
  contact_value: string;
  status: "pending" | "confirmed" | "denied";
  consent_given_at: string;
  consent_text: string;
  consent_version: string;
}

const API = "http://localhost:3001";
type Method = "POST" | "PUT" | "DELETE";

async function api<T>(
  path: string, method?: Method, body?: unknown, signal?: AbortSignal
): Promise<T> {
  const response = await fetch(API + path, {
    credentials: "include",
    cache: "no-store",
    signal,
    ...(method ? { method } : {}),
    ...(body ? {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    } : {})
  });
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "Request failed");
  return data;
}

export default function StudentHousehold() {
  const [dependents, setDependents] = useState<Dependent[]>([]);
  const [contacts, setContacts] = useState<PickupContact[]>([]);
  const [consentText, setConsentText] = useState("");
  const [dependentName, setDependentName] = useState("");
  const [relationship, setRelationship] = useState("child");
  const [contactName, setContactName] = useState("");
  const [contactMethod, setContactMethod] = useState<"phone" | "email">("phone");
  const [contactValue, setContactValue] = useState("");
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const [d, c] = await Promise.all([
      api<{ dependents: Dependent[] }>("/api/household/dependents", undefined, undefined, signal),
      api<{ contacts: PickupContact[] }>("/api/household/contacts", undefined, undefined, signal)
    ]);
    if (!signal?.aborted) {
      setDependents(d.dependents);
      setContacts(c.contacts);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void api<{ text: string }>("/api/household/consent", undefined, undefined, controller.signal)
      .then(data => { if (!controller.signal.aborted) setConsentText(data.text); })
      .catch(e => { if (!controller.signal.aborted) setError((e as Error).message); });

    const tick = () => {
      if (!document.hidden) {
        void refresh(controller.signal).catch(e => {
          if (!controller.signal.aborted) setError((e as Error).message);
        });
      }
    };
    tick();
    const timer = window.setInterval(tick, 5000);
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", tick);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", tick);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [refresh]);

  async function act(
    path: string, method: Method, body?: unknown,
    success = "Record updated"
  ) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await api<{ affectedBookings?: number }>(path, method, body);
      await refresh();
      setMessage(success + (
        result.affectedBookings
          ? ". " + result.affectedBookings +
            " upcoming appointment(s) reverted to student pickup."
          : ""
      ));
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function addDependent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const success = await act("/api/household/dependents", "POST", {
      fullName: dependentName, relationship
    }, "Dependent request submitted for staff review");
    if (success) setDependentName("");
  }

  function resetContactForm() {
    setEditingId(null);
    setContactName("");
    setContactMethod("phone");
    setContactValue("");
    setConsentAccepted(false);
  }

  async function saveContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const success = await act(
      editingId ? "/api/household/contacts/" + editingId : "/api/household/contacts",
      editingId ? "PUT" : "POST",
      {
        fullName: contactName,
        contactMethod,
        contactValue,
        consentAccepted
      },
      editingId
        ? "Contact updated; staff must review the new details and consent"
        : "Pickup contact submitted for staff review"
    );
    if (success) resetContactForm();
  }

  return (
    <>
      <section className="auth-panel">
        <h2>My dependents</h2>
        <p className="auth-muted">
          Request staff confirmation before using a dependent on a booking.
          Only confirmed dependents may be removed, as specified by the RSD.
          If a dependent is assigned to an appointment inside the change cutoff
          (24 hours by default), you must contact staff to change the pickup
          authorization. Use fictional names only.
        </p>
        <form className="auth-fields" onSubmit={e => void addDependent(e)}>
          <label>
            Dependent's fictional full name
            <input required minLength={2} maxLength={100}
              value={dependentName} onChange={e => setDependentName(e.target.value)} />
          </label>
          <label>
            Relationship
            <select required value={relationship} onChange={e => setRelationship(e.target.value)}>
              <option value="child">Child</option>
              <option value="partner">Partner</option>
              <option value="family_member">Other family member</option>
              <option value="other">Other</option>
            </select>
          </label>
          <button disabled={busy} type="submit">Request dependent registration</button>
        </form>
        <h3>Submitted dependents</h3>
        {dependents.length === 0 ? <p>No dependents registered.</p> : (
          <ul className="auth-list">
            {dependents.map(d => (
              <li key={d.id}>
                <strong>{d.full_name}</strong> — {d.relationship.replaceAll("_", " ")}
                <p>Status: <strong>{d.status}</strong></p>
                {d.status === "confirmed" &&
                  <button type="button" disabled={busy}
                    onClick={() => {
                      if (window.confirm("Remove this dependent from your records?")) {
                        void act(
                          "/api/household/dependents/" + d.id, "DELETE",
                          undefined, "Dependent removed"
                        );
                      }
                    }}>
                    Remove confirmed dependent
                  </button>
                }
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="auth-panel">
        <h2>Third-party pickup contacts</h2>
        <p className="auth-muted">
          A third-party contact can collect your hamper only after you provide
          consent and staff confirms the request. Editing a confirmed contact
          resets approval to pending; removing one withdraws authorization.
          You cannot edit or remove a contact assigned to an appointment
          inside its cancellation/change cutoff (24 hours by default).
          The same rule applies to all student-initiated appointment edits;
          contact staff for urgent pickup authorization changes.
        </p>
        <form className="auth-fields" onSubmit={e => void saveContact(e)}>
          {editingId && <p><strong>Editing pickup contact</strong></p>}
          <label>
            Contact's fictional full name
            <input required minLength={2} maxLength={100} value={contactName}
              onChange={e => setContactName(e.target.value)} />
          </label>
          <label>
            Contact method
            <select value={contactMethod}
              onChange={e => {
                setContactMethod(e.target.value as "phone" | "email");
                setContactValue("");
              }}>
              <option value="phone">Phone</option>
              <option value="email">Email</option>
            </select>
          </label>
          <label>
            Fictional {contactMethod === "phone" ? "phone number" : "email"}
            <input required maxLength={160}
              type={contactMethod === "email" ? "email" : "tel"}
              placeholder={contactMethod === "email" ? "contact@example.test" : "250-555-0100"}
              value={contactValue}
              onChange={e => setContactValue(e.target.value)} />
          </label>
          <fieldset className="eligibility-checks">
            <legend>Required pickup authorization</legend>
            <p>{consentText || "Loading consent disclosure..."}</p>
            <label>
              <input type="checkbox" checked={consentAccepted}
                required disabled={!consentText}
                onChange={e => setConsentAccepted(e.target.checked)} />
              I have read the disclosure and explicitly authorize this
              named person to collect my hamper.
            </label>
          </fieldset>
          <div className="auth-actions">
            <button type="submit" disabled={busy || !consentText || !consentAccepted}>
              {editingId ? "Save changes and renew consent" : "Submit pickup contact"}
            </button>
            {editingId &&
              <button type="button" disabled={busy} onClick={resetContactForm}>Cancel editing</button>
            }
          </div>
        </form>
        <h3>Pickup contacts</h3>
        {contacts.length === 0 ? <p>No pickup contacts registered.</p> : (
          <ul className="auth-list">
            {contacts.map(c => (
              <li key={c.id}>
                <strong>{c.full_name}</strong>
                <p>{c.contact_method}: {c.contact_value}</p>
                <p>Status: <strong>{c.status}</strong></p>
                <p className="auth-muted">
                  Consent recorded: {new Date(c.consent_given_at).toLocaleString()}
                </p>
                <div className="auth-actions">
                  <button type="button" disabled={busy}
                    onClick={() => {
                      setEditingId(c.id);
                      setContactName(c.full_name);
                      setContactMethod(c.contact_method);
                      setContactValue(c.contact_value);
                      setConsentAccepted(false); // New explicit approval required.
                    }}>
                    Edit contact
                  </button>
                  <button type="button" disabled={busy}
                    onClick={() => {
                      if (window.confirm("Remove this contact and withdraw pickup consent?")) {
                        void act(
                          "/api/household/contacts/" + c.id, "DELETE",
                          undefined, "Pickup contact removed"
                        ).then(ok => { if (ok && editingId === c.id) resetContactForm(); });
                      }
                    }}>
                    Remove contact
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      {message && <p role="status" className="auth-notice">{message}</p>}
      {error && <p role="alert" className="auth-notice">{error}</p>}
    </>
  );
}
