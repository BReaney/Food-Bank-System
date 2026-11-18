import { useCallback, useEffect, useRef, useState } from "react";

interface Slot {
  id: string;
  term_id: string;
  starts_at: string;
  ends_at: string;
  capacity: number;
  is_open: boolean;
  remaining_capacity: number;
}
interface Booking {
  id: string;
  slot_id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  can_modify: boolean;
  cancellation_cutoff_hours: number;
  pickup_kind: "self" | "dependent" | "third_party";
  pickup_dependent_id: string | null;
  pickup_contact_id: string | null;
  pickup_name: string | null;
}
interface HistoryRecord {
  id: string;
  status: string;
  starts_at: string;
  cancelled_at: string | null;
}
interface EventRecord {
  id: string;
  event_type: string;
  occurred_at: string;
  event_data: {
    from_starts_at?: string;
    to_starts_at?: string;
    starts_at?: string;
    reason?: string;
  };
}

interface PickupOption {
  id: string;
  full_name: string;
  status: "pending" | "confirmed" | "denied";
}
const API = "http://localhost:3001";

function pickupPayload(value: string): Record<string, string> {
  if (value === "self") return { pickupKind: "self" };
  const [pickupKind, pickupId] = value.split(":");
  return { pickupKind, pickupId };
}
function bookingPickupValue(booking: Booking): string {
  if (booking.pickup_kind === "dependent" && booking.pickup_dependent_id) {
    return "dependent:" + booking.pickup_dependent_id;
  }
  if (booking.pickup_kind === "third_party" && booking.pickup_contact_id) {
    return "third_party:" + booking.pickup_contact_id;
  }
  return "self";
}
const REFRESH_MS = 5000;

function dateLabel(value: string): string {
  return new Date(value).toLocaleString("en-CA", {
    timeZone: "America/Vancouver",
    dateStyle: "medium",
    timeStyle: "short"
  });
}

async function fetchData<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(API + path, {
    credentials: "include",
    cache: "no-store",
    signal
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    throw new Error(
      body && typeof body === "object" && "error" in body &&
      typeof body.error === "string" ? body.error : "Request failed"
    );
  }
  return body as T;
}

export default function StudentAppointments() {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [month, setMonth] = useState("");
  const [slotsTruncated, setSlotsTruncated] = useState(false);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [pickupChoices, setPickupChoices] = useState<Record<string, string>>({});
  const [newPickupChoice, setNewPickupChoice] = useState("self");
  const [dependents, setDependents] = useState<PickupOption[]>([]);
  const [contacts, setContacts] = useState<PickupOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const requestNumber = useRef(0);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const requestId = ++requestNumber.current;
    try {
      const [slotResult, bookingResult, historyResult, eventResult, d, c] = await Promise.all([
        fetchData<{ slots: Slot[]; hasMore: boolean }>("/api/slots"+(month ? "?month="+encodeURIComponent(month) : ""), signal),
        fetchData<{ bookings: Booking[] }>("/api/bookings", signal),
        fetchData<{ bookings: HistoryRecord[] }>("/api/bookings/history", signal),
        fetchData<{ events: EventRecord[] }>("/api/bookings/events", signal),
        fetchData<{ dependents: PickupOption[] }>("/api/household/dependents", signal),
        fetchData<{ contacts: PickupOption[] }>("/api/household/contacts", signal)
      ]);
      if (signal?.aborted || requestId !== requestNumber.current) return;

      setSlots(slotResult.slots);
      setSlotsTruncated(slotResult.hasMore);
      setBookings(bookingResult.bookings);
      setHistory(historyResult.bookings);
      setEvents(eventResult.events);
      setDependents(d.dependents);
      setContacts(c.contacts);
      setError("");
    } catch (e) {
      if (!signal?.aborted && requestId === requestNumber.current) {
        setError((e as Error).message);
      }
    } finally {
      if (!signal?.aborted && requestId === requestNumber.current) {
        setInitialLoading(false);
      }
    }
  }, [month]);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const onFocus = () => { if (!document.hidden) void refresh(controller.signal); };
    const timer = window.setInterval(onFocus, REFRESH_MS);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);

    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [refresh]);

  async function mutate(path: string, body?: Record<string, string>, method: "POST" | "PATCH" = "POST") {
    setBusy(true);
    setMessage("");
    setActionError("");
    try {
      const response = await fetch(API + path, {
        method,
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {})
      });
      const data: unknown = await response.json();
      if (!response.ok) {
        const errorText =
          data && typeof data === "object" && "error" in data &&
          typeof data.error === "string" ? data.error : "Unable to update appointment";
        throw new Error(errorText);
      }
      const success =
        data && typeof data === "object" && "message" in data &&
        typeof data.message === "string" ? data.message : "Appointment saved";
      setMessage(success);
      setChoices({});
      setPickupChoices({});
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      await refresh(); // Reconcile even when a slot became full in another session.
      setBusy(false);
    }
  }

  function cancel(booking: Booking) {
    if (!window.confirm("Cancel your appointment on " + dateLabel(booking.starts_at) + "?")) {
      return;
    }
    void mutate("/api/bookings/" + booking.id + "/cancel");
  }

  if (initialLoading) {
    return <section className="auth-panel"><p role="status">Loading appointment availability...</p></section>;
  }

  return (
    <>
      {message && <p className="auth-notice" role="status">{message}</p>}
      {actionError && <p className="auth-notice" role="alert">{actionError}</p>}
      {error && <p className="auth-notice" role="alert">{error}</p>}
      <section className="auth-panel">
        <h2>Upcoming appointment slots</h2>
        <p className="auth-muted">
          Availability refreshes every five seconds and when you return to this page.
          A slot may contain multiple places; it becomes full when its capacity is used.
          Other students' identities are never shown here.
        </p>

        <label className="appointment-choice">
          Who will collect the hamper?
          <select value={newPickupChoice} disabled={busy}
            onChange={e => setNewPickupChoice(e.target.value)}>
            <option value="self">I will collect it myself</option>
            {dependents.filter(d => d.status === "confirmed").map(d => (
              <option key={d.id} value={"dependent:" + d.id}>
                Confirmed dependent: {d.full_name}
              </option>
            ))}
            {contacts.filter(c => c.status === "confirmed").map(c => (
              <option key={c.id} value={"third_party:" + c.id}>
                Approved third-party contact: {c.full_name}
              </option>
            ))}
          </select>
        </label>
        <p className="auth-muted">
          Only confirmed people can be selected. Third-party contacts require
          your recorded consent; approval is checked again when you book.
        </p>
        <label className="appointment-choice">
          Browse appointment month (Vancouver time)
          <input type="month" value={month}
            onChange={e => setMonth(e.target.value)} />
        </label>
        {month && <button type="button" onClick={() => setMonth("")}>
          View all upcoming months
        </button>}
        {slotsTruncated && <p role="status">
          Showing the first 500 slots. Choose a specific month to see
          additional dates.
        </p>}
        <ul className="auth-list">
          {slots.map(slot => {
            const alreadyBooked = bookings.some(b => b.slot_id === slot.id);
            const full = slot.remaining_capacity <= 0;
            const available = slot.is_open && !full;
            return (
              <li key={slot.id}>
                <strong>{dateLabel(slot.starts_at)}</strong>
                <p>{alreadyBooked
                  ? "Your appointment"
                  : !slot.is_open ? "Closed"
                  : full ? "Full"
                  : slot.remaining_capacity + " of " + slot.capacity + " spaces available"}</p>
                <button
                  type="button"
                  disabled={busy || !available || alreadyBooked}
                  onClick={() => void mutate(
                    "/api/bookings",
                    { slotId: slot.id, ...pickupPayload(newPickupChoice) }
                  )}
                >
                  {alreadyBooked ? "Already booked" : full ? "Full" : "Book this slot"}
                </button>
              </li>
            );
          })}
        </ul>
        {slots.length === 0 && <p>No upcoming slots are configured.</p>}
      </section>

      <section className="auth-panel">
        <h2>My upcoming appointments</h2>
        <ul className="auth-list">
          {bookings.map(booking => {
            const alternatives = slots.filter(slot =>
              slot.id !== booking.slot_id &&
              slot.is_open && slot.remaining_capacity > 0
            );
            const selected = choices[booking.id] ?? "";
            return (
              <li key={booking.id}>
                <strong>{dateLabel(booking.starts_at)}</strong>
                <p>Status: {booking.status}</p>
                <p>
                  Pickup: <strong>
                    {booking.pickup_kind === "self"
                      ? "Student collecting"
                      : (booking.pickup_name ?? "Previously authorized pickup person")}
                  </strong>
                </p>
                {booking.can_modify ? (
                  <>
                    <div className="auth-actions">
                      <button type="button" disabled={busy} onClick={() => cancel(booking)}>
                        Cancel appointment
                      </button>
                    </div>
                    <label className="appointment-choice">
                      Change authorized pickup person
                      <select disabled={busy}
                        value={pickupChoices[booking.id] ?? bookingPickupValue(booking)}
                        onChange={e => setPickupChoices(previous => ({
                          ...previous, [booking.id]: e.target.value
                        }))}>
                        <option value="self">Student collecting</option>
                        {dependents.filter(d => d.status === "confirmed").map(d => (
                          <option value={"dependent:" + d.id} key={d.id}>
                            Confirmed dependent: {d.full_name}
                          </option>
                        ))}
                        {contacts.filter(c => c.status === "confirmed").map(c => (
                          <option value={"third_party:" + c.id} key={c.id}>
                            Approved contact: {c.full_name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="auth-actions">
                      <button type="button"
                        disabled={busy ||
                          (pickupChoices[booking.id] ?? bookingPickupValue(booking)) ===
                            bookingPickupValue(booking)}
                        onClick={() => void mutate(
                          "/api/bookings/" + booking.id + "/pickup",
                          pickupPayload(pickupChoices[booking.id] ??
                            bookingPickupValue(booking)),
                          "PATCH"
                        )}>
                        Update pickup authorization
                      </button>
                    </div>
                    <label className="appointment-choice">
                      Choose another available slot
                      <select
                        value={selected}
                        disabled={busy || alternatives.length === 0}
                        onChange={event =>
                          setChoices(current => ({
                            ...current, [booking.id]: event.target.value
                          }))
                        }
                      >
                        <option value="">Select a new appointment time</option>
                        {alternatives.map(slot => (
                          <option key={slot.id} value={slot.id}>
                            {dateLabel(slot.starts_at)} — {slot.remaining_capacity} places left
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="auth-actions">
                      <button
                        type="button" disabled={busy || !selected}
                        onClick={() => void mutate(
                          "/api/bookings/" + booking.id + "/reschedule",
                          { slotId: selected }
                        )}
                      >
                        Reschedule appointment
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="auth-muted">
                    Changes are closed within {booking.cancellation_cutoff_hours} hours
                    of the appointment. Contact staff if assistance is needed.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
        {bookings.length === 0 && <p>No upcoming appointments booked.</p>}
      </section>

      <section className="auth-panel">
        <h2>My booking history</h2>
        <p className="auth-muted">
          Your personal booking records and in-app confirmations.
          These details are visible only to your account and authorized staff.
        </p>
        {history.length === 0 ? (
          <p>No booking history yet.</p>
        ) : (
          <ul className="auth-list">
            {history.slice(0, 10).map(item => (
              <li key={item.id}>
                {dateLabel(item.starts_at)} — <strong>{item.status}</strong>
              </li>
            ))}
          </ul>
        )}
        <h3>Recent appointment activity</h3>
        {events.length === 0 ? <p>No appointment changes recorded.</p> : (
          <ul className="auth-list">
            {events.slice(0, 10).map(event => (
              <li key={event.id}>
                <strong>{event.event_type}</strong> — {dateLabel(event.occurred_at)}
                {event.event_type === "pickup_updated" &&
                  <p>Pickup authorization changed{event.event_data.reason
                    ? " (" + event.event_data.reason.replaceAll("_", " ") + ")" : ""}.</p>}
                {event.event_type === "rescheduled" && event.event_data.to_starts_at &&
                  <p>New appointment: {dateLabel(event.event_data.to_starts_at)}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

    </>
  );
}
