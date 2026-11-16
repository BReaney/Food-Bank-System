import { useEffect, useState } from "react";

interface AppointmentSlot {
  id: string;
  term_id: string;
  starts_at: string;
  ends_at: string;
  capacity: number;
  is_open: boolean;
  booked_count: number;
  remaining_capacity: number;
}

interface DemoBooking {
  id: string;
  slot_id: string;
  status: string;
  booked_at: string;
  starts_at: string;
  ends_at: string;
}

type Feedback = {
  kind: "success" | "error";
  message: string;
};

const API_BASE = "http://localhost:3001";

function displayAppointmentTime(timestamp: string): string {
  return new Date(timestamp).toLocaleString("en-CA", {
    timeZone: "America/Vancouver",
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function App() {
  const [apiStatus, setApiStatus] = useState("Checking API...");
  const [slots, setSlots] = useState<AppointmentSlot[]>([]);
  const [myBookings, setMyBookings] = useState<DemoBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submittingSlotId, setSubmittingSlotId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/health`)
      .then(response => {
        if (!response.ok) {
          throw new Error("API health request failed");
        }
        return response.json();
      })
      .then(data => setApiStatus(data.message))
      .catch(() => setApiStatus("Could not connect to backend"));
  }, []);

  // Read upcoming slots and demo bookings from Express (not hardcoded data).
  useEffect(() => {
    const controller = new AbortController();

    async function loadAppointments() {
      try {
        const [slotsResponse, bookingsResponse] = await Promise.all([
          fetch(`${API_BASE}/api/slots`, { signal: controller.signal }),
          fetch(`${API_BASE}/api/bookings`, { signal: controller.signal })
        ]);

        if (!slotsResponse.ok || !bookingsResponse.ok) {
          throw new Error("An appointment API request failed");
        }

        const slotData: { slots: AppointmentSlot[] } = await slotsResponse.json();
        const bookingData: { bookings: DemoBooking[] } = await bookingsResponse.json();

        if (!controller.signal.aborted) {
          setSlots(slotData.slots);
          setMyBookings(bookingData.bookings);
        }
      } catch {
        if (!controller.signal.aborted) {
          setLoadError(
            "Unable to load appointments. Check that the backend is running " +
            "and ENABLE_DEMO_BOOKING=true is set in backend/.env."
          );
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void loadAppointments();
    return () => controller.abort();
  }, []);

  async function bookSlot(slotId: string) {
    setSubmittingSlotId(slotId);
    setFeedback(null);

    try {
      // The browser only supplies the selected slot; the backend determines
      // the fixed fictional student and enforces every booking rule.
      const response = await fetch(`${API_BASE}/api/bookings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotId })
      });

      const data: { error?: string; booking?: { id: string } } =
        await response.json();

      if (!response.ok) {
        setFeedback({
          kind: "error",
          message: data.error ?? "Unable to create this appointment"
        });
        return;
      }

      setFeedback({
        kind: "success",
        message: "Appointment booked and saved in PostgreSQL!"
      });

      // Refresh both lists so the interface reflects the updated database.
      try {
        const [slotsResponse, bookingsResponse] = await Promise.all([
          fetch(`${API_BASE}/api/slots`),
          fetch(`${API_BASE}/api/bookings`)
        ]);

        if (!slotsResponse.ok || !bookingsResponse.ok) {
          throw new Error("Refresh failed");
        }

        const slotData: { slots: AppointmentSlot[] } = await slotsResponse.json();
        const bookingData: { bookings: DemoBooking[] } = await bookingsResponse.json();
        setSlots(slotData.slots);
        setMyBookings(bookingData.bookings);
      } catch {
        setFeedback({
          kind: "success",
          message: "Booking saved. Refresh the page to update the displayed lists."
        });
      }
    } catch {
      setFeedback({
        kind: "error",
        message: "Could not reach the booking API. Check the backend terminal."
      });
    } finally {
      setSubmittingSlotId(null);
    }
  }

  return (
    <main style={{
      maxWidth: "750px",
      margin: "2rem auto",
      padding: "1rem",
      textAlign: "left"
    }}>
      <h1 style={{ lineHeight: 1.2 }}>UVSS Food Bank Booking System</h1>
      <p>Backend status: {apiStatus}</p>
      <p style={{ marginTop: "0.5rem" }}>
        <strong>Local demonstration only:</strong> Bookings use the fictional
        Alex Example profile. Student login is not implemented yet.
      </p>

      {feedback && (
        <p
          role={feedback.kind === "error" ? "alert" : "status"}
          style={{ marginTop: "1rem", fontWeight: 600 }}
        >
          {feedback.message}
        </p>
      )}

      <section style={{ marginTop: "2rem" }}>
        <h2>Upcoming appointment slots</h2>
        {loading ? (
          <p>Loading appointments...</p>
        ) : loadError ? (
          <p role="alert">{loadError}</p>
        ) : slots.length === 0 ? (
          <p>No upcoming appointment slots have been configured.</p>
        ) : (
          <ul style={{ paddingLeft: "1.5rem" }}>
            {slots.map(slot => {
              const alreadyBooked = myBookings.some(
                booking => booking.slot_id === slot.id
              );
              const unavailable = !slot.is_open || slot.remaining_capacity <= 0;
              const busy = submittingSlotId !== null;

              return (
                <li key={slot.id} style={{ marginBottom: "1.25rem" }}>
                  <strong>{displayAppointmentTime(slot.starts_at)}</strong>
                  <div>
                    {!slot.is_open
                      ? "Closed"
                      : slot.remaining_capacity <= 0
                        ? "Full"
                        : `${slot.remaining_capacity} of ${slot.capacity} spaces available`}
                  </div>
                  <button
                    type="button"
                    style={{ marginTop: "0.4rem", padding: "0.5rem 0.75rem" }}
                    disabled={unavailable || busy || alreadyBooked}
                    onClick={() => void bookSlot(slot.id)}
                  >
                    {alreadyBooked
                      ? "Already booked"
                      : submittingSlotId === slot.id
                        ? "Booking..."
                        : "Book this slot (demo)"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section style={{ marginTop: "2rem" }}>
        <h2>My upcoming appointments (demo)</h2>
        {!loading && !loadError && (
          myBookings.length === 0 ? (
            <p>No appointments booked yet.</p>
          ) : (
            <ul>
              {myBookings.map(booking => (
                <li key={booking.id}>
                  {displayAppointmentTime(booking.starts_at)} — {booking.status}
                </li>
              ))}
            </ul>
          )
        )}
      </section>
    </main>
  );
}

export default App;
