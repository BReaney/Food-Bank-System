import { useEffect, useState } from "react";
import type { FormEvent } from "react";

const API = "http://localhost:3001";
const PAGE_SIZE = 25;
type Page = {
  limit: number; offset: number; total: number;
  hasNext: boolean; hasPrevious: boolean;
};
type Student = {
  id: string; first_name: string; last_name: string; email: string;
  created_at?: string;
};
type Term = {
  id: string; code: string; name: string; starts_on: string; ends_on: string;
  enrollment_status: "pending" | "verified" | "rejected" | null;
  verified_at: string | null; survey_submitted_at: string | null;
};
type EnrollmentEvent = {
  id: string; term_id: string; previous_status: string | null;
  new_status: string; occurred_at: string;
};
type BookingEvent = {
  id: string; event_type: string; occurred_at: string;
};
type Appointment = {
  id: string; status: string; week_start: string; booked_at: string;
  cancelled_at: string | null; starts_at: string; ends_at: string;
  term_code: string; term_name: string;
  pickup_kind: "self" | "dependent" | "third_party";
  pickup_name: string | null; events: BookingEvent[];
};
type Dependent = {
  id: string; full_name: string; relationship: string; status: string;
  created_at: string; reviewed_at: string | null;
};
type Contact = {
  id: string; full_name: string; contact_method: string;
  contact_value: string; status: string;
  consent_given_at: string; created_at: string; reviewed_at: string | null;
};
type StudentRecord = {
  student: Student; terms: Term[]; enrollmentEvents: EnrollmentEvent[];
  appointments: Appointment[]; appointmentsPagination: Page;
  dependents: Dependent[]; contacts: Contact[];
};

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium", timeStyle: "short", timeZone: "America/Vancouver"
  }).format(date);
}

function displayStatus(value: string): string {
  return value.replace(/_/g, " ");
}

async function requestJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(API + url, {
    credentials: "include", cache: "no-store", signal
  });
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "Unable to load staff records");
  return data;
}

export default function StaffRecords() {
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [searchRevision, setSearchRevision] = useState(0);
  const [offset, setOffset] = useState(0);
  const [students, setStudents] = useState<Student[]>([]);
  const [page, setPage] = useState<Page | null>(null);
  const [searchLoading, setSearchLoading] = useState(true);
  const [searchError, setSearchError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [appointmentOffset, setAppointmentOffset] = useState(0);
  const [record, setRecord] = useState<StudentRecord | null>(null);
  const [recordRevision, setRecordRevision] = useState(0);
  const [recordLoading, setRecordLoading] = useState(false);
  const [recordError, setRecordError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setSearchLoading(true);
    setSearchError("");
    setStudents([]);
    setPage(null);
    const params = new URLSearchParams({
      search, limit: String(PAGE_SIZE), offset: String(offset)
    });
    void (async () => {
      try {
        const result = await requestJson<{ students: Student[]; pagination: Page }>(
          "/api/staff/records?" + params.toString(), controller.signal
        );
        if (controller.signal.aborted) return;
        if (result.pagination.total > 0 && result.students.length === 0 && offset > 0) {
          setOffset(Math.floor((result.pagination.total - 1) / PAGE_SIZE) * PAGE_SIZE);
          return;
        }
        setStudents(result.students);
        setPage(result.pagination);
      } catch (error) {
        if (!controller.signal.aborted) setSearchError((error as Error).message);
      } finally {
        if (!controller.signal.aborted) setSearchLoading(false);
      }
    })();
    return () => controller.abort();
  }, [search, offset, searchRevision]);

  useEffect(() => {
    if (!selectedId) {
      setRecord(null);
      setRecordError("");
      setRecordLoading(false);
      return;
    }
    const controller = new AbortController();
    setRecord(null);
    setRecordLoading(true);
    setRecordError("");
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE), offset: String(appointmentOffset)
    });
    void (async () => {
      try {
        const result = await requestJson<StudentRecord>(
          "/api/staff/records/" + selectedId + "?" + params.toString(),
          controller.signal
        );
        if (!controller.signal.aborted) setRecord(result);
      } catch (error) {
        if (!controller.signal.aborted) setRecordError((error as Error).message);
      } finally {
        if (!controller.signal.aborted) setRecordLoading(false);
      }
    })();
    return () => controller.abort();
  }, [selectedId, appointmentOffset, recordRevision]);

  function applySearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSelectedId(null);
    setRecord(null);
    setAppointmentOffset(0);
    setOffset(0);
    setSearch(input.trim());
    setSearchRevision(value => value + 1);
  }

  function clearSearch() {
    setInput("");
    setSearch("");
    setSearchRevision(value => value + 1);
    setOffset(0);
    setSelectedId(null);
    setRecord(null);
    setAppointmentOffset(0);
  }

  function viewStudent(id: string) {
    // Clear the previous student's private data before requesting another.
    setRecord(null);
    setSelectedId(id);
    setAppointmentOffset(0);
    setRecordRevision(value => value + 1);
  }

  return (
    <section className="auth-panel" aria-labelledby="staff-records-title">
      <h2 id="staff-records-title">Unified staff records menu</h2>
      <p className="auth-muted">
        Read-only student records. Restricted to signed-in staff; searches and
        record views are logged. Fictional test accounts only.
      </p>
      <form className="staff-search-form" onSubmit={applySearch}>
        <label htmlFor="records-search">Search student names or email addresses</label>
        <div className="staff-search-row">
          <input id="records-search" type="search" maxLength={100}
            value={input} onChange={event => setInput(event.target.value)}
            placeholder="Search all student profiles" />
          <button type="submit">Search</button>
          <button type="button" onClick={clearSearch}>Clear</button>
        </div>
      </form>

      <div className="staff-records-layout">
        <div aria-label="Student search results">
          <h3>Students</h3>
          {searchLoading && <p role="status">Searching student records...</p>}
          {searchError && <p role="alert" className="auth-notice">{searchError}</p>}
          {!searchLoading && !searchError && page && (
            <>
              <p className="auth-muted" role="status">
                Showing {page.total === 0 ? 0 : page.offset + 1}–{page.offset + students.length} of {page.total}
                {search ? " matches" : " students"}.
              </p>
              {students.length === 0 ? (
                <p role="status">No Records Found</p>
              ) : (
                <ul className="auth-list staff-record-results">
                  {students.map(student => (
                    <li key={student.id}>
                      <strong>{student.first_name} {student.last_name}</strong>
                      <p className="staff-record-email">{student.email}</p>
                      <button type="button"
                        aria-pressed={selectedId === student.id}
                        disabled={recordLoading && selectedId === student.id}
                        onClick={() => viewStudent(student.id)}>
                        {selectedId === student.id ? "Refresh record" : "View record"}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <nav className="staff-pagination" aria-label="Student search pages">
                <button type="button" disabled={!page.hasPrevious || searchLoading}
                  onClick={() => { setOffset(Math.max(0, offset - PAGE_SIZE)); setSelectedId(null); }}>
                  Previous
                </button>
                <span>Page {Math.floor(page.offset / PAGE_SIZE) + 1} of {Math.max(1, Math.ceil(page.total / PAGE_SIZE))}</span>
                <button type="button" disabled={!page.hasNext || searchLoading}
                  onClick={() => { setOffset(offset + PAGE_SIZE); setSelectedId(null); }}>
                  Next
                </button>
              </nav>
            </>
          )}
        </div>

        <div className="staff-record-detail" aria-live="polite">
          <h3>Student record</h3>
          {!selectedId && <p className="auth-muted">Select a student to inspect their records.</p>}
          {recordLoading && <p role="status">Loading selected student record...</p>}
          {recordError && <p role="alert" className="auth-notice">{recordError}</p>}
          {record && selectedId === record.student.id && (
            <>
              <div className="staff-record-profile">
                <h4>{record.student.first_name} {record.student.last_name}</h4>
                <p>{record.student.email}</p>
                <p>Profile created: {formatDateTime(record.student.created_at ?? null)}</p>
              </div>

              <h4>Enrollment and eligibility history</h4>
              <p className="auth-muted">
                Survey completion and staff enrollment verification are independent.
                No submitted questionnaire answers are displayed.
              </p>
              {record.terms.length === 0 ? <p>No terms configured.</p> : (
                <ul className="staff-record-timeline">
                  {record.terms.map(term => {
                    const events = record.enrollmentEvents.filter(item => item.term_id === term.id);
                    return (
                      <li key={term.id}>
                        <strong>{term.name} ({term.code})</strong>
                        <p>{term.starts_on} to {term.ends_on}</p>
                        <p>Enrollment: <strong>{
                          term.enrollment_status ? displayStatus(term.enrollment_status) : "No verification recorded"
                        }</strong></p>
                        <p>Eligibility survey: {term.survey_submitted_at
                          ? "Submitted " + formatDateTime(term.survey_submitted_at)
                          : "Not submitted"}</p>
                        {term.verified_at && <p>Verified: {formatDateTime(term.verified_at)}</p>}
                        {events.length > 0 && (
                          <details>
                            <summary>Verification decisions ({events.length})</summary>
                            <ul>
                              {events.map(item => (
                                <li key={item.id}>
                                  {item.previous_status ?? "none"} → {displayStatus(item.new_status)}
                                  {" — "}{formatDateTime(item.occurred_at)}
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

              <h4>Appointment history</h4>
              <p className="auth-muted">
                All booking statuses are included. Rescheduled appointments are
                displayed at their latest scheduled slot, with change events underneath.
              </p>
              {record.appointments.length === 0 ? (
                <p>No appointments on this page.</p>
              ) : (
                <ul className="staff-record-timeline">
                  {record.appointments.map(appointment => (
                    <li key={appointment.id}>
                      <strong>{formatDateTime(appointment.starts_at)} — {displayStatus(appointment.status)}</strong>
                      <p>{appointment.term_name} ({appointment.term_code})</p>
                      <p>Pickup: {appointment.pickup_kind === "self"
                        ? "Student"
                        : appointment.pickup_kind === "dependent" ? "Dependent" : "Third party"}
                        {appointment.pickup_name ? " — " + appointment.pickup_name : ""}</p>
                      <p>Booked: {formatDateTime(appointment.booked_at)}</p>
                      {appointment.cancelled_at && (
                        <p>Cancelled: {formatDateTime(appointment.cancelled_at)}</p>
                      )}
                      {appointment.events.length > 0 && (
                        <details>
                          <summary>Booking changes ({appointment.events.length})</summary>
                          <ul>
                            {appointment.events.map(event => (
                              <li key={event.id}>
                                {displayStatus(event.event_type)} — {formatDateTime(event.occurred_at)}
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <nav className="staff-pagination" aria-label="Appointment history pages">
                <button type="button" disabled={!record.appointmentsPagination.hasPrevious || recordLoading}
                  onClick={() => setAppointmentOffset(value => Math.max(0, value - PAGE_SIZE))}>
                  Newer appointments
                </button>
                <span>
                  {record.appointmentsPagination.total === 0 ? 0 : record.appointmentsPagination.offset + 1}
                  –{record.appointmentsPagination.offset + record.appointments.length} of {record.appointmentsPagination.total}
                </span>
                <button type="button" disabled={!record.appointmentsPagination.hasNext || recordLoading}
                  onClick={() => setAppointmentOffset(value => value + PAGE_SIZE)}>
                  Older appointments
                </button>
              </nav>

              <h4>Registered dependents</h4>
              {record.dependents.length === 0 ? <p>No active registered dependents.</p> : (
                <ul className="staff-record-timeline">
                  {record.dependents.map(dependent => (
                    <li key={dependent.id}>
                      <strong>{dependent.full_name}</strong>
                      <p>Relationship: {displayStatus(dependent.relationship)}</p>
                      <p>Status: {displayStatus(dependent.status)}</p>
                    </li>
                  ))}
                </ul>
              )}

              <h4>Third-party pickup contacts</h4>
              {record.contacts.length === 0 ? <p>No active third-party pickup contacts.</p> : (
                <ul className="staff-record-timeline">
                  {record.contacts.map(contact => (
                    <li key={contact.id}>
                      <strong>{contact.full_name}</strong>
                      <p>Status: {displayStatus(contact.status)}</p>
                      <p>{displayStatus(contact.contact_method)}: {contact.contact_value}</p>
                      <p>Consent recorded: {formatDateTime(contact.consent_given_at)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
