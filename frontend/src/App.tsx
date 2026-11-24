// Existing feature screens stay unchanged; only their page-level composition moves.
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import "./auth.css";
import StudentEligibility from "./StudentEligibility";
import StaffEnrollment from "./StaffEnrollment";
import StaffRecords from "./StaffRecords";
import StaffAppointments from "./StaffAppointments";
import StaffCalendar from "./StaffCalendar";
import StaffReports from "./StaffReports";
import StudentNotifications from "./StudentNotifications";
import StudentAppointments from "./StudentAppointments";
import StudentHousehold from "./StudentHousehold";
import DietaryChoices from "./DietaryChoices";
import type { DietaryRestriction } from "./DietaryChoices";
import StaffHousehold from "./StaffHousehold";
import {
  canonicalPageHash, pageHash, pagesForRole, resolvePage
} from "./pageNavigation";

type StudentDesignation = "domestic" | "international";

interface Profile {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  role: "student" | "staff";
  student_designation: StudentDesignation | null;
  dietary_restrictions: DietaryRestriction[];
}
type Message = { text: string; isError: boolean };
const API = "http://localhost:3001";

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(API + path, {
    credentials: "include", // Sends the HTTP-only session cookie to Express.
    ...options
  });
  const data: unknown = await response.json();
  if (!response.ok) {
    const errorMessage =
      typeof data === "object" && data !== null &&
      "error" in data && typeof data.error === "string"
        ? data.error
        : "The request failed";
    throw new Error(errorMessage);
  }
  return data as T;
}

function App() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [studentDesignation, setStudentDesignation] = useState<StudentDesignation | "">("");
  const [dietaryRestrictions, setDietaryRestrictions] = useState<DietaryRestriction[]>([]);
  const [editingFirst, setEditingFirst] = useState("");
  const [editingLast, setEditingLast] = useState("");
  const [editingDesignation, setEditingDesignation] = useState<StudentDesignation | "">("");
  const [editingDietary, setEditingDietary] = useState<DietaryRestriction[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [pageHashValue, setPageHashValue] = useState(() => window.location.hash);
  const activePage = profile ? resolvePage(profile.role, pageHashValue) : null;

  // Hash URLs make each page bookmarkable and keep Back/Forward working without
  // adding a router or changing the Express/Vite server configuration.
  useEffect(() => {
    const onHashChange = () => setPageHashValue(window.location.hash);
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    if (!profile) return;
    const canonical = canonicalPageHash(profile.role, pageHashValue);
    if (window.location.hash !== canonical) {
      window.history.replaceState(null, "", canonical);
      setPageHashValue(canonical);
    }
  }, [profile, pageHashValue]);

  useEffect(() => {
    if (!profile || !activePage) return;
    // Focus the newly displayed page heading for keyboard/screen reader users.
    document.getElementById("app-page-heading")?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [profile?.id, activePage?.id]);

  async function refreshSession() {
    try {
      const result = await api<{ profile: Profile }>("/api/auth/me");
      setProfile(result.profile);
      setEditingFirst(result.profile.first_name);
      setEditingLast(result.profile.last_name);
      setEditingDesignation(result.profile.student_designation ?? "");
      setEditingDietary(result.profile.dietary_restrictions ?? []);
    } catch {
      setProfile(null);
    } finally {
      setCheckingSession(false);
    }
  }

  useEffect(() => {
    void refreshSession();
  }, []);

  async function submitCredentials(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const path = mode === "register" ? "/api/auth/register" : "/api/auth/login";
      const result = await api<{ message: string }>(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName, lastName, email, password,
          ...(mode === "register" ? { studentDesignation, dietaryRestrictions } : {}) })
      });
      setPassword("");
      setMessage({ text: result.message, isError: false });

      if (mode === "register") {
        setStudentDesignation("");
        setDietaryRestrictions([]);
        setMode("login"); // The RSD describes signing in after registration.
      } else {
        await refreshSession();
      }
    } catch (error) {
      setMessage({ text: (error as Error).message, isError: true });
    } finally {
      setBusy(false);
    }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const result = await api<{ profile: Profile }>("/api/profile/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName: editingFirst, lastName: editingLast,
          ...(profile?.role === "student" ? {
            studentDesignation: editingDesignation,
            dietaryRestrictions: editingDietary
          } : {}) })
      });
      setProfile(result.profile);
      setEditingFirst(result.profile.first_name);
      setEditingLast(result.profile.last_name);
      setEditingDesignation(result.profile.student_designation ?? "");
      setEditingDietary(result.profile.dietary_restrictions ?? []);
      setMessage({ text: "Profile changes saved.", isError: false });
    } catch (error) {
      setMessage({ text: (error as Error).message, isError: true });
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    setMessage(null);
    try {
      await api("/api/auth/logout", { method: "POST" });
      setProfile(null);
    } catch (error) {
      setMessage({ text: (error as Error).message, isError: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <h1>UVSS Food Bank Booking System</h1>
      <p className="auth-muted">Portfolio prototype — fictional accounts only.</p>

      {message && (
        <p className="auth-notice" role={message.isError ? "alert" : "status"}>
          {message.text}
        </p>
      )}

      {checkingSession ? (
        <p>Checking your login session...</p>
      ) : !profile ? (
        <section className="auth-panel">
          <h2>{mode === "register" ? "Create a student profile" : "Sign in"}</h2>
          <p>Use a fictional address such as student1@example.test.</p>
          <form className="auth-fields" onSubmit={event => void submitCredentials(event)}>
            {mode === "register" && (
              <>
                <label>
                  First name
                  <input required maxLength={100} value={firstName}
                    onChange={event => setFirstName(event.target.value)} />
                </label>
                <label>
                  Last name
                  <input required maxLength={100} value={lastName}
                    onChange={event => setLastName(event.target.value)} />
                </label>
                <label>
                  Student designation
                  <select required value={studentDesignation}
                    onChange={event => setStudentDesignation(event.target.value as StudentDesignation | "")}>
                    <option value="">Select designation</option>
                    <option value="domestic">Domestic</option>
                    <option value="international">International</option>
                  </select>
                </label>
                <DietaryChoices selected={dietaryRestrictions} onChange={setDietaryRestrictions} disabled={busy} />
              </>
            )}
            <label>
              Email address
              <input type="email" required autoComplete="email"
                value={email} onChange={event => setEmail(event.target.value)} />
            </label>
            <label>
              Password {mode === "register" ? "(at least 12 characters)" : ""}
              <input type="password" required
                minLength={mode === "register" ? 12 : undefined}
                autoComplete={mode === "register" ? "new-password" : "current-password"}
                value={password} onChange={event => setPassword(event.target.value)} />
            </label>
            <div className="auth-actions">
              <button type="submit" disabled={busy || (mode === "register" && dietaryRestrictions.length === 0)}>
                {busy ? "Working..." : mode === "register" ? "Create profile" : "Sign in"}
              </button>
              <button type="button" disabled={busy} onClick={() => {
                setMessage(null);
                setPassword("");
                setMode(mode === "register" ? "login" : "register");
              }}>
                {mode === "register" ? "Already registered? Sign in" : "Create a student profile"}
              </button>
            </div>
          </form>
          <p className="auth-muted">
            Staff profiles are provisioned by a local administrator,
            not through public registration.
          </p>
        </section>
      ) : (
        <>
          <div className="app-account-bar">
            <span>
              Signed in as <strong>{profile.email}</strong>
              <span className="app-role-label">{profile.role === "staff" ? "Staff" : "Student"}</span>
            </span>
            <button type="button" onClick={() => void logout()} disabled={busy}>
              Sign out
            </button>
          </div>

          {activePage && (
            <div className="app-workspace">
              <nav className="app-page-nav" aria-label={profile.role === "staff" ? "Staff pages" : "Student pages"}>
                <h2 className="app-nav-heading">Navigate</h2>
                <div className="app-nav-items">
                  {pagesForRole(profile.role).map(page => (
                    <a
                      key={page.id}
                      className="app-nav-link"
                      href={pageHash(profile.role, page.id)}
                      aria-current={activePage.id === page.id ? "page" : undefined}
                    >
                      {page.label}
                    </a>
                  ))}
                </div>
              </nav>

              <section className="app-page-content" aria-labelledby="app-page-heading">
                <header className="app-page-header">
                  <h2 id="app-page-heading" tabIndex={-1}>{activePage.label}</h2>
                  <p className="auth-muted">{activePage.description}</p>
                </header>

                {activePage.id === "profile" ? (
                  <section className="auth-panel" aria-labelledby="profile-title">
                    <h2 id="profile-title">Account information</h2>
                    <form className="auth-fields" onSubmit={event => void saveProfile(event)}>
                      <label>
                        First name
                        <input required maxLength={100} value={editingFirst}
                          onChange={event => setEditingFirst(event.target.value)} />
                      </label>
                      <label>
                        Last name
                        <input required maxLength={100} value={editingLast}
                          onChange={event => setEditingLast(event.target.value)} />
                      </label>
                      {profile.role === "student" && (
                        <>
                          <label>
                            Student designation
                            <select required value={editingDesignation}
                              onChange={event => setEditingDesignation(event.target.value as StudentDesignation | "")}>
                              <option value="">Select designation</option>
                              <option value="domestic">Domestic</option>
                              <option value="international">International</option>
                            </select>
                          </label>
                          <DietaryChoices selected={editingDietary} onChange={setEditingDietary} disabled={busy} />
                        </>
                      )}
                      <button type="submit" disabled={busy ||
                        (profile.role === "student" && editingDietary.length === 0)}>Save profile</button>
                    </form>
                    <p className="auth-muted">
                      Email and account role are read-only. Editing those values requires
                      additional verification workflows. Student designation and dietary
                      preferences are self-reported, fictional demo fields.
                    </p>
                  </section>
                ) : profile.role === "student" ? (
                  <>
                    {activePage.id === "appointments" && <StudentAppointments />}
                    {activePage.id === "eligibility" && <StudentEligibility />}
                    {activePage.id === "household" && <StudentHousehold />}
                    {activePage.id === "notifications" && <StudentNotifications />}
                  </>
                ) : (
                  <>
                    {activePage.id === "calendar" && <StaffCalendar />}
                    {activePage.id === "appointments" && <StaffAppointments />}
                    {activePage.id === "enrollment" && <StaffEnrollment />}
                    {activePage.id === "household" && <StaffHousehold />}
                    {activePage.id === "records" && <StaffRecords />}
                    {activePage.id === "reports" && <StaffReports />}
                  </>
                )}
              </section>
            </div>
          )}
        </>
      )}
    </main>
  );
}

export default App;
