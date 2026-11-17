import express from "express";
import cors from "cors";
import { pool } from "./db.js";
import { demoBookingsRouter } from "./routes/demoBookings.js";

const app = express();
const PORT = 3001;

// Allow requests from our local React application.
app.use(cors({ origin: "http://localhost:5173" }));

// Allow the server to read JSON request bodies.
app.use(express.json());

// A simple route to check that the backend is running.
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    message: "UVSS Food Bank API is running"
  });
});

app.get("/api/db-health", async (_req, res) => {
  try {
    const result = await pool.query(
      "SELECT current_database() AS database, now() AS server_time"
    );

    res.json({
      status: "connected",
      database: result.rows[0].database,
      serverTime: result.rows[0].server_time
    });
  } catch (error) {
    console.error("Database connection error:", error);

    res.status(500).json({
      status: "error",
      message: "Database connection failed"
    });
  }
});

// Shape of one row returned by our PostgreSQL availability view.
// PostgreSQL TIMESTAMPTZ values are read as Date objects by node-postgres.
interface SlotRow {
  id: string;
  term_id: string;
  starts_at: Date;
  ends_at: Date;
  capacity: number;
  is_open: boolean;
  booked_count: number;
  remaining_capacity: number;
}

// Read-only endpoint: show upcoming slots, including full and closed slots.
app.get("/api/slots", async (_req, res) => {
  try {
    const result = await pool.query<SlotRow>(`
      SELECT id, term_id, starts_at, ends_at, capacity,
             is_open, booked_count, remaining_capacity
      FROM slot_availability
      WHERE starts_at >= NOW()
      ORDER BY starts_at ASC
      LIMIT 50
    `);

    // Express converts Date objects to ISO 8601 strings in the JSON.
    res.json({ slots: result.rows });
  } catch (error) {
    console.error("Failed to load appointment slots:", error);
    res.status(500).json({
      error: "Unable to retrieve appointment slots"
    });
  }
});

// Temporary local-only POST/GET routes for the fictional demo student.
app.use("/api/bookings", demoBookingsRouter);

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
