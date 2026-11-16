import { useEffect, useState } from "react";

// Matches the JSON fields returned by GET /api/slots.
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

function App() {
  const [apiStatus, setApiStatus] = useState("Checking API...");
  const [slots, setSlots] = useState<AppointmentSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(true);
  const [slotsError, setSlotsError] = useState<string | null>(null);

  useEffect(() => {
    fetch("http://localhost:3001/api/health")
      .then((response) => {
        if (!response.ok) {
          throw new Error("API health request failed");
        }
        return response.json();
      })
      .then((data) => {
        setApiStatus(data.message);
      })
      .catch(() => {
        setApiStatus("Could not connect to backend");
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    async function loadSlots() {
      try {
        const response = await fetch("http://localhost:3001/api/slots", {
          signal: controller.signal
        });

        if (!response.ok) {
          throw new Error("Failed to retrieve appointment slots");
        }

        // TypeScript helps us use this response consistently.
        // Runtime response validation will be added in a later milestone.
        const data: { slots: AppointmentSlot[] } = await response.json();
        if (!controller.signal.aborted) {
          setSlots(data.slots);
        }
      } catch {
        if (!controller.signal.aborted) {
          setSlotsError("Could not retrieve appointment slots. Check the backend and database.");
        }
      } finally {
        if (!controller.signal.aborted) {
          setSlotsLoading(false);
        }
      }
    }

    void loadSlots();
    return () => controller.abort();
  }, []);

  return (
    <main style={{ maxWidth: "750px", margin: "2rem auto", padding: "1rem" }}>
      <h1>UVSS Food Bank Booking System</h1>
      <p>Backend status: {apiStatus}</p>

      <h2>Upcoming appointment slots</h2>

      {slotsLoading ? (
        <p>Loading appointments...</p>
      ) : slotsError ? (
        <p role="alert">{slotsError}</p>
      ) : slots.length === 0 ? (
        <p>No upcoming appointment slots have been configured.</p>
      ) : (
        <ul>
          {slots.map((slot) => (
            <li key={slot.id}>
              <strong>
                {new Date(slot.starts_at).toLocaleString("en-CA", {
                  timeZone: "America/Vancouver",
                  dateStyle: "medium",
                  timeStyle: "short"
                })}
              </strong>
              {" — "}
              {!slot.is_open
                ? "Closed"
                : slot.remaining_capacity <= 0
                  ? "Full"
                  : `${slot.remaining_capacity} of ${slot.capacity} spaces available`}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

export default App;
