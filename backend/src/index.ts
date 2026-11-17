import express from "express";
import cors from "cors";
import { pool } from "./db.js";
import { bookingsRouter } from "./routes/bookings.js";
import { authRouter } from "./routes/auth.js";
import { profileRouter } from "./routes/profiles.js";
import { staffRouter } from "./routes/staff.js";
import { termsRouter } from "./routes/terms.js";
import { eligibilityRouter } from "./routes/eligibility.js";
import { enrollmentStaffRouter } from "./routes/enrollmentStaff.js";
import { requireUser } from "./security/sessions.js";

const app = express();
const PORT = 3001;

// The prototype can only be used on this developer's computer.
// It is deliberately disabled in production until security review.
const frontendOrigin = process.env.FRONTEND_ORIGIN ?? "http://localhost:5173";
const localhostIPs = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

app.use(cors({ origin: frontendOrigin, credentials: true }));
app.use(express.json({ limit: "16kb" }));

app.use("/api", (req, res, next) => {
  const protectedPaths = ["/auth", "/profile", "/staff", "/slots", "/bookings", "/eligibility", "/terms"];
  if (!protectedPaths.some(path => req.path === path || req.path.startsWith(path + "/"))) {
    next();
    return;
  }

  if (process.env.NODE_ENV === "production" ||
      process.env.ENABLE_PROTOTYPE_AUTH !== "true" ||
      !localhostIPs.has(req.socket.remoteAddress ?? "")) {
    res.status(404).json({ error: "Prototype endpoints disabled" });
    return;
  }

  // The browser's Origin check protects against cross-origin form submissions.
  // It is not a substitute for a trusted authentication session.
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.get("origin") !== frontendOrigin) {
    res.status(403).json({ error: "Invalid request origin" });
    return;
  }

  next();
});

// A simple route to check that the backend is running.
app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    message: "UVSS Food Bank API is running"
  });
});

app.get("/api/db-health", async (_req, res) => {
  try {
    if (process.env.NODE_ENV === "production") {
      res.status(404).json({ error: "Not found" });
      return;
    }
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
app.get("/api/slots", requireUser, async (_req, res) => {
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

// All profile, staff and booking operations are session-protected.
app.use("/api/auth", authRouter);
app.use("/api/profile", profileRouter);
app.use("/api/staff", staffRouter);
app.use("/api/staff/enrollments", enrollmentStaffRouter);
app.use("/api/terms", termsRouter);
app.use("/api/eligibility", eligibilityRouter);
app.use("/api/bookings", bookingsRouter);

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
