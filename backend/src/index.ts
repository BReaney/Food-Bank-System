import express from "express";
import cors from "cors";
import { pool } from "./db.js";

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

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});