import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import "./auth.css";
import StudentEligibility from "./StudentEligibility";
import StaffEnrollment from "./StaffEnrollment";
import StaffDirectory from "./StaffDirectory";
import StaffAppointments from "./StaffAppointments";
import StaffCalendar from "./StaffCalendar";
import StudentNotifications from "./StudentNotifications";
import StudentAppointments from "./StudentAppointments";
import StudentHousehold from "./StudentHousehold";
import StaffHousehold from "./StaffHousehold";

interface Profile {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  role: "student" | "staff";
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
  const [editingFirst, setEditingFirst] = useState("");
  const [editingLast, setEditingLast] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  async function refreshSession() {
    try {
      const result = await api<{ profile: Profile }>("/api/auth/me");
      setProfile(result.profile);
      setEditingFirst(result.profile.first_name);
      setEditingLast(result.profile.last_name);
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
        body: JSON.stringify({ firstName, lastName, email, password })
      });
      setPassword("");
      setMessage({ text: result.message, isError: false });

      if (mode === "register") {
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
        body: JSON.stringify({ firstName: editingFirst, lastName: editingLast })
      });
      setProfile(result.profile);
      setEditingFirst(result.profile.first_name);
      setEditingLast(result.profile.last_name);
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
              <button type="submit" disabled={busy}>
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
          <section className="auth-panel">
            <div className="auth-actions">
              <strong>Signed in as {profile.email} ({profile.role})</strong>
              <button type="button" onClick={() => void logout()} disabled={busy}>
                Sign out
              </button>
            </div>
            <h2>My profile</h2>
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
              <button type="submit" disabled={busy}>Save profile</button>
            </form>
            <p className="auth-muted">
              Email and account role are read-only. Editing those values requires
              additional verification workflows.
            </p>
          </section>

          {profile.role === "student" ? (
            <>
              <StudentEligibility />
              <StudentHousehold />
              <StudentNotifications />
              <StudentAppointments />
            </>
          ) : (
            <>
            <StaffCalendar />
            <StaffAppointments />
            <StaffHousehold />
            <StaffEnrollment />
            <StaffDirectory />
            </>
          )}
        </>
      )}
    </main>
  );
}

export default App;
